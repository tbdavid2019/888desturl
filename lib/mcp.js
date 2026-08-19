'use strict';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: '888desturl',
  version: '1.0.0'
};

const MCP_TOOLS = [
  {
    name: 'trace_url',
    description:
      'Trace the final destination of a redirecting URL through HTTP 3xx redirects, HTML meta refresh, and JavaScript navigation. Automatically unpacks wrapped links (YouTube, Facebook, Google, Slack, etc.), checks Google Web Risk safety, and strips marketing tracking parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The target URL to trace (must start with http:// or https://).'
        },
        context: {
          type: 'string',
          enum: ['default', 'line'],
          description:
            "Optional tracing context. Set to 'line' when tracing URLs meant for the LINE in-app browser or LIFF links."
        }
      },
      required: ['url']
    }
  },
  {
    name: 'clean_url',
    description:
      'Analyze and clean marketing/tracking query parameters (such as utm_*, fbclid, gclid, etc.) from a URL without making network requests.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to strip tracking parameters from.'
        }
      },
      required: ['url']
    }
  }
];

function createMcpHandler(options = {}) {
  const { onTrace, onClean, serverInfo = SERVER_INFO } = options;

  async function handleJsonRpc(body, request) {
    if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: (body && body.id) || null,
        error: {
          code: -32600,
          message: 'Invalid Request: jsonrpc must be "2.0"'
        }
      };
    }

    const { id, method, params = {} } = body;

    // Standard MCP handshake
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo
        }
      };
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };
    }

    // List available tools (called by Cloudflare WebMCP bridge.js)
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS
        }
      };
    }

    // Call a tool
    if (method === 'tools/call') {
      const toolName = params.name;
      const toolArgs = params.arguments || {};

      if (toolName === 'trace_url') {
        if (!onTrace) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Trace handler not configured.' }],
              isError: true
            }
          };
        }

        try {
          const result = await onTrace(toolArgs, request);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }
              ],
              isError: false
            }
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Trace failed: ${error.message || 'Unknown error'}`
                }
              ],
              isError: true
            }
          };
        }
      }

      if (toolName === 'clean_url') {
        if (!onClean) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: 'Clean handler not configured.' }],
              isError: true
            }
          };
        }

        try {
          const result = await onClean(toolArgs, request);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }
              ],
              isError: false
            }
          };
        } catch (error) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Clean failed: ${error.message || 'Unknown error'}`
                }
              ],
              isError: true
            }
          };
        }
      }

      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Unknown tool: ${toolName}`
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`
      }
    };
  }

  return {
    handleJsonRpc,
    getTools: () => MCP_TOOLS,
    getServerInfo: () => serverInfo,
    getProtocolVersion: () => MCP_PROTOCOL_VERSION
  };
}

module.exports = {
  MCP_PROTOCOL_VERSION,
  SERVER_INFO,
  MCP_TOOLS,
  createMcpHandler
};
