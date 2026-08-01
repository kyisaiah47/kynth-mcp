#!/usr/bin/env node
// kynth-mcp entry point.
//
//   kynth-mcp                 stdio transport (Claude Code / Claude Desktop)
//   kynth-mcp --http [port]   streamable HTTP transport (default port 8974)

import { buildServer } from '../src/server.js';

const args = process.argv.slice(2);

if (args.includes('--http')) {
  const portArg = args[args.indexOf('--http') + 1];
  const port = /^\d+$/.test(portArg || '') ? Number(portArg) : 8974;
  const { default: express } = await import('express');
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const app = express();
  app.use(express.json());

  // Stateless mode: a fresh server + transport per request. Both tools are
  // read-only lookups, so there is no session state worth keeping.
  app.post('/mcp', async (req, res) => {
    try {
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('mcp request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const reject = (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST /mcp only (stateless).' },
      id: null,
    });
  };
  app.get('/mcp', reject);
  app.delete('/mcp', reject);

  app.listen(port, () => {
    console.error(`kynth-mcp listening on http://localhost:${port}/mcp (streamable HTTP, stateless)`);
  });
} else {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('kynth-mcp running on stdio');
}
