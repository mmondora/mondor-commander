const https = require('https');
const http = require('http');

const MAX_TOOL_ITERATIONS = 10;

class ChatProxy {
  constructor(mcpManager, ws) {
    this.mcpManager = mcpManager;
    this.ws = ws;
    this.conversations = new Map(); // sessionId -> messages[]
  }

  async handleMessage(sessionId, userMessage) {
    // Get or create conversation
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    const messages = this.conversations.get(sessionId);

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    const llmConfig = this.mcpManager.config.llm || {};
    const tools = this.mcpManager.getToolsForLLM();

    let iteration = 0;

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      // Call LLM
      let response;
      try {
        response = await this._callLLM(llmConfig, messages, tools);
      } catch (err) {
        this.ws.broadcast({
          type: 'chat:done',
          sessionId,
          error: `LLM error: ${err.message}`,
        });
        return;
      }

      const choice = response.choices && response.choices[0];
      if (!choice) {
        this.ws.broadcast({
          type: 'chat:done',
          sessionId,
          error: 'No response from LLM',
        });
        return;
      }

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      // Check for tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const fnName = toolCall.function.name;
          let args = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            args = {};
          }

          // Parse serverName__toolName
          const sepIdx = fnName.indexOf('__');
          if (sepIdx === -1) {
            const errorResult = { error: `Invalid tool name format: ${fnName}` };
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(errorResult),
            });
            this.ws.broadcast({
              type: 'chat:tool_result',
              sessionId,
              toolName: fnName,
              result: errorResult,
              isError: true,
            });
            continue;
          }

          const serverName = fnName.substring(0, sepIdx);
          const toolName = fnName.substring(sepIdx + 2);

          // Broadcast tool call
          this.ws.broadcast({
            type: 'chat:tool_call',
            sessionId,
            serverName,
            toolName,
            args,
          });

          // Execute tool
          let result;
          let isError = false;
          try {
            result = await this.mcpManager.callTool(serverName, toolName, args);
          } catch (err) {
            result = { error: err.message };
            isError = true;
          }

          // Format result content for the LLM
          let resultContent;
          if (result && result.content) {
            resultContent = result.content
              .map(c => {
                if (c.type === 'text') return c.text;
                if (c.type === 'image') return '[image]';
                return JSON.stringify(c);
              })
              .join('\n');
          } else {
            resultContent = JSON.stringify(result);
          }

          // Truncate large results
          if (resultContent.length > 8000) {
            resultContent = resultContent.substring(0, 8000) + '\n... (truncated)';
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultContent,
          });

          // Broadcast tool result
          this.ws.broadcast({
            type: 'chat:tool_result',
            sessionId,
            serverName,
            toolName,
            result: resultContent,
            isError,
          });
        }

        // Continue loop to let LLM process tool results
        continue;
      }

      // No tool calls — final response
      const content = assistantMessage.content || '';

      this.ws.broadcast({
        type: 'chat:done',
        sessionId,
        content,
      });
      return;
    }

    // Hit max iterations
    this.ws.broadcast({
      type: 'chat:done',
      sessionId,
      content: messages[messages.length - 1]?.content || '',
      warning: `Tool use loop capped at ${MAX_TOOL_ITERATIONS} iterations`,
    });
  }

  clearConversation(sessionId) {
    this.conversations.delete(sessionId);
  }

  async _callLLM(llmConfig, messages, tools) {
    const baseUrl = llmConfig.baseUrl || 'http://localhost:11434/v1';
    const model = llmConfig.model || 'llama3.2';
    const apiKey = llmConfig.apiKey || '';
    const maxTokens = llmConfig.maxTokens || 4096;

    const url = new URL(baseUrl);
    const chatUrl = `${url.origin}${url.pathname.replace(/\/$/, '')}/chat/completions`;

    const body = {
      model,
      messages,
      max_tokens: maxTokens,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    const parsed = new URL(chatUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            ...headers,
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 120000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              if (res.statusCode >= 400) {
                reject(new Error(`LLM API error ${res.statusCode}: ${data.substring(0, 500)}`));
                return;
              }
              const json = JSON.parse(data);
              resolve(json);
            } catch (err) {
              reject(new Error(`LLM response parse error: ${err.message}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('LLM request timeout'));
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = { ChatProxy };
