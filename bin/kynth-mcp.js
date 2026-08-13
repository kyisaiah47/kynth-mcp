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

  // Stateless mode: a fresh server + transport per request. Every tool is a read-only lookup, so
  // there is no session state worth keeping. (Said "Both tools" while ten shipped.)
  app.post('/mcp', async (req, res) => {
    try {
      const server = buildServer();
      /* ⛔ DNS-REBINDING PROTECTION. Without it any page in the user's browser can POST to this
       * local server and drive it: measured 2026-08-13, a request carrying
       * `Origin: https://evil.example.com` returned HTTP 200 and a valid initialize result. */
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableDnsRebindingProtection: true,
        allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
      });
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

  /* ⛔ LOOPBACK ONLY. `app.listen(port)` binds 0.0.0.0 — confirmed with lsof on 2026-08-13,
   * `TCP *:8974 (LISTEN)` — so this local dev server was reachable from every device on the
   * network. Nothing about an MCP server for one user's agent wants that. */
  app.listen(port, '127.0.0.1', () => {
    console.error(`kynth-mcp listening on http://127.0.0.1:${port}/mcp (streamable HTTP, stateless, loopback only)`);
  });
} else {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error('kynth-mcp running on stdio');
}
