// Smoke test: spawn the stdio server as a real MCP client would, list tools,
// call both tools, print the live responses. Exits non-zero on any failure.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('../bin/kynth-mcp.js', import.meta.url).pathname],
});
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS:', tools.map((t) => t.name).join(', '));

const [domain, ein] = process.argv.slice(2);

const ada = await client.callTool({
  name: 'lookup_ada_report',
  arguments: { domain: domain || '36thdistrictcourtmi.gov' },
});
console.log('\n=== lookup_ada_report ===');
console.log(ada.content[0].text);

const gs = await client.callTool({
  name: 'lookup_nonprofit_status',
  arguments: { ein: ein || '475262842' },
});
console.log('\n=== lookup_nonprofit_status ===');
console.log(gs.content[0].text);

await client.close();
