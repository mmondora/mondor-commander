const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { Walker } = require('../scanner/walker.js');
const { hashFiles } = require('../scanner/hasher.js');
const { analyze } = require('../scanner/analyzer.js');
const { createApiRouter } = require('./api.js');
const { WsBroadcaster } = require('./websocket.js');
const { McpManager } = require('./mcp-manager.js');
const { ChatProxy } = require('./chat-proxy.js');
const { createMcpRouter } = require('./mcp-api.js');
const { buildSyncPlan } = require('../scanner/sync-plan.js');
const { analyzePhotos } = require('../scanner/photos/analyzer.js');

async function startServer(config) {
  const app = express();
  const server = http.createServer(app);
  const ws = new WsBroadcaster();
  ws.attach(server);

  // Shared state store
  const store = {
    config,
    status: 'scanning',
    progress: { left: { scanned: 0, found: 0 }, right: { scanned: 0, found: 0 } },
    scanLeft: null,
    scanRight: null,
    analysis: null,
    syncPlan: null,
    photoAnalysis: null,
  };

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:*");
    next();
  });

  // JSON body parser
  app.use(express.json());

  // API routes
  app.use('/api', createApiRouter(store));

  // MCP integration
  let mcpManager = null;
  let chatProxy = null;
  if (config.mcpConfig) {
    mcpManager = new McpManager(config.mcpConfig, ws);
    chatProxy = new ChatProxy(mcpManager, ws);
    app.use('/api/mcp', createMcpRouter(mcpManager, chatProxy));

    // Handle WebSocket messages from clients (chat)
    ws.onMessage = (msg) => {
      if (msg.type === 'chat:send' && msg.message) {
        const sessionId = msg.sessionId || 'default';
        chatProxy.handleMessage(sessionId, msg.message).catch(err => {
          console.error('Chat WS error:', err.message);
        });
      }
    };
  }

  // Serve fonts
  app.use('/fonts', express.static(path.join(__dirname, '..', 'frontend', 'fonts')));

  // Serve frontend
  const frontendPath = path.join(__dirname, '..', 'frontend', 'index.html');
  app.get('/', async (req, res) => {
    try {
      const html = await fs.readFile(frontendPath, 'utf-8');
      res.type('html').send(html);
    } catch (err) {
      res.status(500).send('Frontend not found');
    }
  });

  // Global error handler (must be last middleware)
  app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  await new Promise((resolve, reject) => {
    server.listen(config.port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const url = `http://localhost:${config.port}`;
  console.log(`\n  Mondor Commander running at ${url}`);
  console.log('  Press Ctrl+C to stop\n');

  // Init MCP servers
  if (mcpManager) {
    mcpManager.init().catch(err => {
      console.error('  MCP init error:', err.message);
    });
  }

  // Graceful shutdown for MCP
  const origClose = server.close.bind(server);
  server.close = async function(...args) {
    if (mcpManager) {
      console.log('  Shutting down MCP servers...');
      await mcpManager.shutdown();
    }
    return origClose(...args);
  };

  // Auto-open browser
  if (config.autoOpen) {
    try {
      const open = (await import('open')).default;
      await open(url);
    } catch (err) {
      // Ignore open errors
    }
  }

  // Start scanning in background
  runScan(config, store, ws).catch(err => {
    console.error('Scan error:', err.message);
    ws.error(err.message);
    store.status = 'error';
  });

  return server;
}

async function runScan(config, store, ws) {
  const walker = new Walker(config);

  walker.on('progress', ({ side, scanned, found }) => {
    store.progress[side] = { scanned, found };
    ws.scanProgress(side, scanned, found);
  });

  // Scan left
  console.log(`  Scanning ${config.path1}...`);
  store.scanLeft = await walker.walk(config.path1, 'left');
  console.log(`  Left: ${store.scanLeft.totalFiles} files, ${store.scanLeft.totalSizeHuman}`);
  ws.scanComplete('left', store.scanLeft.scanDuration);

  // Hash left
  if (config.hash) {
    console.log('  Hashing left...');
    await hashFiles(store.scanLeft.files, config.maxFileSize, (done, total) => {
      ws.scanProgress('left', done, total);
    });
  }

  // Scan right (if dual mode)
  if (config.dualMode) {
    console.log(`  Scanning ${config.path2}...`);
    store.scanRight = await walker.walk(config.path2, 'right');
    console.log(`  Right: ${store.scanRight.totalFiles} files, ${store.scanRight.totalSizeHuman}`);
    ws.scanComplete('right', store.scanRight.scanDuration);

    if (config.hash) {
      console.log('  Hashing right...');
      await hashFiles(store.scanRight.files, config.maxFileSize, (done, total) => {
        ws.scanProgress('right', done, total);
      });
    }
  }

  // Analyze
  store.status = 'analyzing';
  console.log('  Analyzing...');
  store.analysis = analyze(store.scanLeft, store.scanRight);

  // Auto-create sync plan in dual mode
  if (config.dualMode && store.analysis.comparison) {
    store.syncPlan = buildSyncPlan(store.analysis.comparison, config.path1, config.path2);
  }

  // Photo analysis
  if (config.photos !== false) {
    const photoFiles = [
      ...(store.scanLeft ? store.scanLeft.files.filter(f => f.isPhoto) : []),
      ...(store.scanRight ? store.scanRight.files.filter(f => f.isPhoto) : []),
    ];
    if (photoFiles.length >= 5) {
      if (photoFiles.length > 20000) {
        console.log(`  Warning: ${photoFiles.length} photos detected. Consider --no-photos for faster scan.`);
      } else if (photoFiles.length > 5000) {
        console.log(`  Note: ${photoFiles.length} photos — analysis may take a few minutes.`);
      }
      console.log(`  Analyzing ${photoFiles.length} photos...`);
      ws.photosStart(photoFiles.length);
      const photoStart = Date.now();
      store.photoAnalysis = await analyzePhotos(
        store.scanLeft, store.scanRight,
        config.photoThreshold || 'exact',
        (done, total, phase) => {
          ws.photosProgress(done, total, phase);
        }
      );
      const photoDuration = Date.now() - photoStart;
      const vdCount = store.photoAnalysis ? store.photoAnalysis.totalVisualDuplicateGroups : 0;
      ws.photosComplete(photoDuration, vdCount);
      console.log(`  Photos: ${photoFiles.length} analyzed, ${vdCount} visual duplicate groups (${(photoDuration/1000).toFixed(1)}s)`);
    }
  }

  store.status = 'ready';
  ws.analysisComplete();

  const duration = (store.scanLeft.scanDuration + (store.scanRight ? store.scanRight.scanDuration : 0)) / 1000;
  console.log(`  Ready! Scan completed in ${duration.toFixed(1)}s`);
}

module.exports = { startServer };
