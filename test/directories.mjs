// Smoke test for the seven directory tools: spawn the stdio server as a real MCP client
// would, call each one against the live API, and fail loudly on an empty or errored result.
//
// This hits production on purpose. The failure these tools have is not a crash — it is a
// silently empty `results: []` when an upstream response shape drifts, which type-checks
// fine, returns 200, and reads to an agent as "nothing matches your query".
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: [new URL('../bin/kynth-mcp.js', import.meta.url).pathname],
});
const client = new Client({ name: 'directories-smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`TOOLS (${tools.length}): ${tools.map((t) => t.name).join(', ')}\n`);

const CASES = [
  ['search_agent_configs', { stack: 'nextjs', limit: 2 }, (r) => r.configs?.length],
  ['search_agent_skills', { q: 'code review', limit: 2 }, (r) => r.results?.length],
  ['search_component_registries', { q: 'data table', limit: 2 }, (r) => r.items?.length],
  ['compare_ai_models', { limit: 3 }, (r) => r.models?.length],
  ['compare_ai_models', { board: 'tool/claude-code', limit: 3 }, (r) => r.models?.length],
  ['check_project_maintenance', { limit: 2 }, (r) => r.results?.length],
  ['grade_starter_kit', { limit: 2 }, (r) => r.kits?.length],
  ['lookup_service_pricing', { category: 'auth' }, (r) => r.services?.length],
  ['estimate_stack_cost', { stack: 'supabase,clerk,polar,vercel' }, (r) => r.services?.length],
];

let failed = 0;
for (const [name, args, count] of CASES) {
  const res = await client.callTool({ name, arguments: args });
  const data = JSON.parse(res.content[0].text);
  const n = count(data) || 0;
  const bad = data.error || n === 0;
  if (bad) failed++;
  console.log(`${bad ? '✗' : '✓'} ${name.padEnd(30)} ${data.error ? `ERROR ${data.error}` : `${n} row(s)`}`);
  if (bad) console.log(`   ${JSON.stringify(data).slice(0, 400)}`);
}

await client.close();
console.log(failed ? `\n${failed}/${CASES.length} failed` : `\nall ${CASES.length} live`);
process.exit(failed ? 1 : 0);
