const express = require('express');

function createMcpRouter(mcpManager, chatProxy) {
  const router = express.Router();
  router.use(express.json());

  // ──── Server Management ────

  // GET /api/mcp/servers - List all servers with status
  router.get('/servers', (req, res) => {
    res.json({ servers: mcpManager.getServerList() });
  });

  // POST /api/mcp/servers - Add a new server
  router.post('/servers', async (req, res) => {
    try {
      const { name, command, args, env, autoStart } = req.body;
      if (!name || !command) {
        return res.status(400).json({ error: 'name and command are required' });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid server name (use alphanumeric, _, -)' });
      }
      const config = {
        command,
        args: args || [],
        env: env || {},
        autoStart: autoStart || false,
      };
      const result = await mcpManager.addServer(name, config);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/mcp/servers/:name - Remove a server
  router.delete('/servers/:name', async (req, res) => {
    try {
      await mcpManager.removeServer(req.params.name);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/mcp/servers/:name/start - Start a server
  router.post('/servers/:name/start', async (req, res) => {
    try {
      await mcpManager.startServer(req.params.name);
      res.json({ ok: true, status: 'connected' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/mcp/servers/:name/stop - Stop a server
  router.post('/servers/:name/stop', async (req, res) => {
    try {
      await mcpManager.stopServer(req.params.name);
      res.json({ ok: true, status: 'stopped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──── Tools ────

  // GET /api/mcp/tools - List all tools from all connected servers
  router.get('/tools', (req, res) => {
    res.json({ tools: mcpManager.getTools() });
  });

  // GET /api/mcp/tools/:server - Tools from a specific server
  router.get('/tools/:server', (req, res) => {
    try {
      const tools = mcpManager.getTools(req.params.server);
      res.json({ tools });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/mcp/tools/:server/:tool - Invoke a tool
  router.post('/tools/:server/:tool', async (req, res) => {
    try {
      const result = await mcpManager.callTool(
        req.params.server,
        req.params.tool,
        req.body || {}
      );
      res.json({ result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──── LLM Config ────

  // GET /api/mcp/llm/config - Get LLM config (without apiKey)
  router.get('/llm/config', (req, res) => {
    res.json(mcpManager.getLlmConfig());
  });

  // PUT /api/mcp/llm/config - Update LLM config
  router.put('/llm/config', async (req, res) => {
    try {
      const result = await mcpManager.updateLlmConfig(req.body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ──── Chat ────

  // POST /api/mcp/chat - Send a chat message (triggers async WS response)
  router.post('/chat', async (req, res) => {
    try {
      const { message, sessionId } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }
      const sid = sessionId || 'default';

      // Respond immediately, results come via WebSocket
      res.json({ ok: true, sessionId: sid });

      // Process in background
      chatProxy.handleMessage(sid, message).catch(err => {
        console.error('Chat error:', err.message);
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/mcp/chat/:sessionId - Clear conversation
  router.delete('/chat/:sessionId', (req, res) => {
    chatProxy.clearConversation(req.params.sessionId);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createMcpRouter };
