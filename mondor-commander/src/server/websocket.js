const { WebSocketServer } = require('ws');

class WsBroadcaster {
  constructor() {
    this.clients = new Set();
    this.wss = null;
    this.lastStatus = null;
  }

  attach(server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: ({ origin, req }) => {
        // Allow connections with no origin (e.g. CLI WebSocket clients)
        if (!origin) return true;
        try {
          const url = new URL(origin);
          return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        } catch {
          return false;
        }
      },
    });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      // Send current status to newly connected clients so they don't miss past events
      if (this.lastStatus && ws.readyState === 1) {
        ws.send(JSON.stringify(this.lastStatus));
      }
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === 1) { // OPEN
        client.send(msg);
      }
    }
  }

  scanProgress(side, scanned, found) {
    this.broadcast({ type: 'scan:progress', side, scanned, found });
  }

  scanComplete(side, duration) {
    this.broadcast({ type: 'scan:complete', side, duration });
  }

  analysisComplete() {
    this.lastStatus = { type: 'analysis:complete' };
    this.broadcast(this.lastStatus);
  }

  error(message) {
    this.lastStatus = { type: 'error', message };
    this.broadcast(this.lastStatus);
  }
}

module.exports = { WsBroadcaster };
