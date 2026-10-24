'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMcpHandler, MCP_TOOLS, MCP_PROTOCOL_VERSION } = require('../lib/mcp');

test('MCP handler initialize responds with standard MCP handshake', async () => {
  const handler = createMcpHandler();
  const response = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 1);
  assert.equal(response.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.ok(response.result.capabilities.tools);
  assert.equal(response.result.serverInfo.name, '888desturl');
});

test('MCP handler ping returns empty object', async () => {
  const handler = createMcpHandler();
  const response = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'ping'
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 2);
  assert.deepEqual(response.result, {});
});

test('MCP handler tools/list returns trace_url and clean_url definitions', async () => {
  const handler = createMcpHandler();
  const response = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {}
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 3);
  assert.ok(Array.isArray(response.result.tools));

  const toolNames = response.result.tools.map((t) => t.name);
  assert.ok(toolNames.includes('trace_url'));
  assert.ok(toolNames.includes('clean_url'));

  const traceTool = response.result.tools.find((t) => t.name === 'trace_url');
  assert.equal(traceTool.inputSchema.type, 'object');
  assert.deepEqual(traceTool.inputSchema.required, ['url']);
});

test('MCP handler tools/call clean_url correctly strips marketing parameters', async () => {
  const handler = createMcpHandler({
    onClean: async (args) => {
      const { analyzeUrl } = require('../lib/url-cleaner');
      const cleaned = analyzeUrl(args.url);
      return {
        input_url: args.url,
        clean_url: cleaned.clean_url,
        has_tracking: (cleaned.removed_tracking_parameters || []).length > 0,
        removed_tracking_parameters: cleaned.removed_tracking_parameters || []
      };
    }
  });

  const response = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'clean_url',
      arguments: {
        url: 'https://example.com/item?id=123&utm_source=facebook&utm_medium=cpc'
      }
    }
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 4);
  assert.equal(response.result.isError, false);
  assert.equal(response.result.content[0].type, 'text');

  const parsed = JSON.parse(response.result.content[0].text);
  assert.equal(parsed.clean_url, 'https://example.com/item?id=123');
  assert.equal(parsed.has_tracking, true);
  assert.deepEqual(parsed.removed_tracking_parameters, ['utm_source', 'utm_medium']);
});

test('MCP handler tools/call trace_url invokes onTrace and returns structured tool result', async () => {
  const handler = createMcpHandler({
    onTrace: async (args) => {
      return {
        input_url: args.url,
        final_url: 'https://final-destination.com',
        clean_url: 'https://final-destination.com',
        redirect_count: 2,
        security: { status: 'safe', threat_types: [] },
        technologies: [
          {
            name: 'Nginx',
            version: '1.24.0',
            confidence: 100,
            categories: [{ id: 22, name: 'Web servers' }]
          }
        ]
      };
    }
  });

  const response = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'trace_url',
      arguments: {
        url: 'https://short.link/xyz'
      }
    }
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 5);
  assert.equal(response.result.isError, false);

  const parsed = JSON.parse(response.result.content[0].text);
  assert.equal(parsed.final_url, 'https://final-destination.com');
  assert.equal(parsed.redirect_count, 2);
  assert.equal(parsed.technologies.length, 1);
  assert.equal(parsed.technologies[0].name, 'Nginx');
  assert.equal(parsed.technologies[0].version, '1.24.0');
});

test('MCP handler returns error for unknown tool and unknown method', async () => {
  const handler = createMcpHandler();

  const unknownToolResponse = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'non_existent_tool', arguments: {} }
  });
  assert.equal(unknownToolResponse.error.code, -32601);

  const unknownMethodResponse = await handler.handleJsonRpc({
    jsonrpc: '2.0',
    id: 7,
    method: 'unknown_method'
  });
  assert.equal(unknownMethodResponse.error.code, -32601);

  const invalidJsonRpc = await handler.handleJsonRpc({ method: 'ping' });
  assert.equal(invalidJsonRpc.error.code, -32600);
});
