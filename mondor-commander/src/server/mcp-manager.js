const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs/promises');

// Dynamic import for ESM MCP SDK
let Client, StdioClientTransport;

async function loadSdk() {
  if (Client) return;
  const sdk = await import('@modelcontextprotocol/sdk/client/index.js');
  const transport = await import('@modelcontextprotocol/sdk/client/stdio.js');
  Client = sdk.Client;
  StdioClientTransport = transport.StdioClientTransport;
}

class McpManager {
  constructor(configPath, ws) {
    this.configPath = configPath;
    this.ws = ws;
    this.servers = new Map(); // name -> { config, process, client, transport, status, tools }
    this.config = { mcpServers: {}, llm: {} };
  }

  async init() {
    await loadSdk();
    await this.loadConfig();

    // Auto-start servers
    for (const [name, cfg] of Object.entries(this.config.mcpServers)) {
      this.servers.set(name, {
        config: cfg,
        process: null,
        client: null,
        transport: null,
        status: 'stopped',
        tools: [],
      });
      if (cfg.autoStart) {
        this.startServer(name).catch(err => {
          console.error(`  MCP auto-start failed for ${name}:`, err.message);
        });
      }
    }
  }

  async loadConfig() {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(raw);
    } catch (err) {
      console.error(`  MCP config load error: ${err.message}`);
      this.config = { mcpServers: {}, llm: {} };
    }
  }

  async saveConfig() {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2) + '\n', 'utf-8');
  }

  getServerList() {
    const list = [];
    for (const [name, srv] of this.servers) {
      list.push({
        name,
        status: srv.status,
        command: srv.config.command,
        args: srv.config.args || [],
        toolCount: srv.tools.length,
      });
    }
    return list;
  }

  async startServer(name) {
    const srv = this.servers.get(name);
    if (!srv) throw new Error(`Server "${name}" not found`);
    if (srv.status === 'connected') return;

    srv.status = 'starting';
    this._broadcast('mcp:server:status', { name, status: 'starting' });

    try {
      const env = { ...process.env, ...(srv.config.env || {}) };

      srv.transport = new StdioClientTransport({
        command: srv.config.command,
        args: srv.config.args || [],
        env,
      });

      srv.client = new Client({
        name: 'mondor-commander',
        version: '1.0.0',
      });

      await srv.client.connect(srv.transport);

      // List tools
      const result = await srv.client.listTools();
      srv.tools = (result.tools || []).map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
      }));

      srv.status = 'connected';
      this._broadcast('mcp:server:status', { name, status: 'connected' });
      this._broadcast('mcp:tools:updated', { name, tools: srv.tools });
      console.log(`  MCP server "${name}" connected (${srv.tools.length} tools)`);
    } catch (err) {
      srv.status = 'error';
      srv.client = null;
      srv.transport = null;
      this._broadcast('mcp:server:status', { name, status: 'error', error: err.message });
      throw err;
    }
  }

  async stopServer(name) {
    const srv = this.servers.get(name);
    if (!srv) throw new Error(`Server "${name}" not found`);
    if (srv.status === 'stopped') return;

    try {
      if (srv.client) {
        await srv.client.close();
      }
    } catch (err) {
      // Ignore close errors
    }

    srv.client = null;
    srv.transport = null;
    srv.tools = [];
    srv.status = 'stopped';
    this._broadcast('mcp:server:status', { name, status: 'stopped' });
    console.log(`  MCP server "${name}" stopped`);
  }

  async addServer(name, config) {
    if (this.servers.has(name)) throw new Error(`Server "${name}" already exists`);

    this.config.mcpServers[name] = config;
    this.servers.set(name, {
      config,
      process: null,
      client: null,
      transport: null,
      status: 'stopped',
      tools: [],
    });
    await this.saveConfig();
    return { name, status: 'stopped' };
  }

  async removeServer(name) {
    const srv = this.servers.get(name);
    if (!srv) throw new Error(`Server "${name}" not found`);

    if (srv.status !== 'stopped') {
      await this.stopServer(name);
    }

    this.servers.delete(name);
    delete this.config.mcpServers[name];
    await this.saveConfig();
  }

  getTools(serverName) {
    if (serverName) {
      const srv = this.servers.get(serverName);
      if (!srv) throw new Error(`Server "${serverName}" not found`);
      return srv.tools.map(t => ({ ...t, server: serverName }));
    }
    // All tools
    const tools = [];
    for (const [name, srv] of this.servers) {
      if (srv.status === 'connected') {
        for (const t of srv.tools) {
          tools.push({ ...t, server: name });
        }
      }
    }
    return tools;
  }

  async callTool(serverName, toolName, args = {}) {
    const srv = this.servers.get(serverName);
    if (!srv) throw new Error(`Server "${serverName}" not found`);
    if (srv.status !== 'connected') throw new Error(`Server "${serverName}" is not connected`);

    const result = await srv.client.callTool({
      name: toolName,
      arguments: args,
    });
    return result;
  }

  // Get all tools formatted for OpenAI function calling
  getToolsForLLM() {
    const tools = [];
    for (const [name, srv] of this.servers) {
      if (srv.status !== 'connected') continue;
      for (const t of srv.tools) {
        tools.push({
          type: 'function',
          function: {
            name: `${name}__${t.name}`,
            description: t.description,
            parameters: t.inputSchema,
          },
        });
      }
    }
    return tools;
  }

  getLlmConfig() {
    const { apiKey, ...safe } = this.config.llm || {};
    return safe;
  }

  async updateLlmConfig(updates) {
    this.config.llm = { ...this.config.llm, ...updates };
    await this.saveConfig();
    return this.getLlmConfig();
  }

  async shutdown() {
    const names = [...this.servers.keys()];
    for (const name of names) {
      try {
        await this.stopServer(name);
      } catch (err) {
        // Ignore shutdown errors
      }
    }
  }

  _broadcast(type, data) {
    if (this.ws) {
      this.ws.broadcast({ type, ...data });
    }
  }
}

module.exports = { McpManager };
