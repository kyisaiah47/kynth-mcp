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

/* ⛔ THE HEADER OF THIS FILE HAS SAID "Exits non-zero on any failure" SINCE IT WAS WRITTEN, AND IT
 * DID NOT. It printed whatever came back and returned 0.
 *
 * What that cost: lookup_nonprofit_status returned an MCP protocol error for EVERY input it ever
 * received — GoodStanding's endpoint serves application/x-ndjson and the client called res.json(),
 * which dies on the second line — and this test printed
 * "Unexpected non-whitespace character after JSON at position 35" under its own heading and exited
 * 0. A test that prints a failure and passes is worse than no test, because it is evidence.
 *
 * Two assertions, because either alone is insufficient: `isError` catches a thrown tool, and
 * parsing the payload catches a tool that returns a 200 full of nothing. */
const failures = [];
for (const [name, res] of [['lookup_ada_report', ada], ['lookup_nonprofit_status', gs]]) {
  if (res.isError) {
    failures.push(`${name}: returned isError — ${res.content?.[0]?.text?.slice(0, 160)}`);
    continue;
  }
  const text = res.content?.[0]?.text;
  if (!text) {
    failures.push(`${name}: returned no text content`);
    continue;
  }
  try {
    JSON.parse(text);
  } catch (e) {
    failures.push(`${name}: payload is not JSON — ${String(e.message).slice(0, 120)}`);
  }
}

await client.close();

if (failures.length) {
  console.error(`\n✗ ${failures.length} tool(s) failed:`);
  for (const f of failures) console.error(`    · ${f}`);
  process.exit(1);
}
console.log(`\n✓ both compliance tools answered with parseable JSON`);
