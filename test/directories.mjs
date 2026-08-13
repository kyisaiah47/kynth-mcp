// Smoke test for the ten directory tools: spawn the stdio server as a real MCP client would,
// call each one against the live API, and fail loudly on an empty OR a hollow result.
//
// This hits production on purpose. The failure these tools have is not a crash — it is a silently
// empty `results: []` when an upstream response shape drifts, which type-checks fine, returns 200,
// and reads to an agent as "nothing matches your query".
//
// ⛔ COUNTING ROWS IS NOT TESTING THEM, AND THIS FILE LEARNED THAT THE EXPENSIVE WAY.
//
// It used to assert exactly one thing per tool: that the array had a non-zero length. It reported
// 9/9 PASSING on a build where three tools were returning rows with their promised fields missing
// — the field maps had drifted from the upstream shape, so every row was `{}`-shaped padding with
// the right cardinality. An agent calling those tools got the correct NUMBER of useless answers,
// and the only gate that could have said so was busy counting them.
//
// So each case now names the keys its own tool DESCRIPTION promises, and the first row has to
// carry them. Two strengths, because they are different claims:
//
//   required — the key must be present AND non-null. The tool is advertised as answering this.
//   present  — the key must exist; null is a legitimate answer. `price_band` is genuinely null for
//              a model outside a band, and demanding a value would make this gate flaky, which is
//              how a gate gets ignored. Absence is still a failure: a missing key is drift, a null
//              value is data.
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
  {
    name: 'search_agent_configs',
    args: { stack: 'nextjs', limit: 2 },
    rows: (r) => r.configs,
    required: ['repo', 'format', 'path', 'url', 'quality'],
    present: ['covers', 'stacks', 'commands', 'words'],
  },
  {
    name: 'search_agent_skills',
    args: { q: 'code review', limit: 2 },
    rows: (r) => r.results,
    // The description sells "install with one line", so `install` is not decoration.
    required: ['name', 'kind', 'repo', 'description', 'install', 'url'],
    present: ['installs', 'stars', 'score'],
  },
  {
    name: 'search_component_registries',
    args: { q: 'data table', limit: 2 },
    rows: (r) => r.items,
    required: ['name', 'registry', 'type'],
    present: ['title', 'description', 'dependencies', 'files'],
  },
  {
    name: 'compare_ai_models',
    args: { limit: 3 },
    rows: (r) => r.models,
    // `rationale` carries "ranked on usage, not capability". A row without it is a ranking an
    // agent will over-read, which is the specific harm this tool has to avoid.
    required: ['rank', 'model', 'score', 'rationale'],
    present: ['blended_usd_per_mtok', 'price_band'],
    top: {
      required: ['board', 'method_summary', 'method_url', 'available_boards'],
      // Regression guard for the 2026-08-13 trim: the full 1,324-byte method document must never
      // come back on every call again. It is a document and it lives at `method_url`.
      absent: ['method'],
    },
  },
  {
    name: 'compare_ai_models',
    label: 'compare_ai_models (tool board)',
    args: { board: 'tool/claude-code', limit: 3 },
    rows: (r) => r.models,
    required: ['rank', 'model', 'rationale'],
  },
  {
    name: 'check_project_maintenance',
    args: { limit: 2 },
    rows: (r) => r.results,
    // `last_release` is legitimately null for a repo that has never cut one; `last_commit` is not.
    required: ['name', 'status', 'last_commit', 'url'],
    present: ['last_release', 'stars'],
  },
  {
    name: 'grade_starter_kit',
    args: { limit: 2 },
    rows: (r) => r.kits,
    required: ['name', 'grade', 'score', 'url'],
    present: ['stack', 'coverage', 'price'],
  },
  {
    name: 'lookup_service_pricing',
    args: { category: 'auth' },
    rows: (r) => r.services,
    required: ['service', 'name', 'category', 'pricing_url', 'plans'],
    // The tool's own description promises every plan carries the date it was last checked. That
    // promise is inside the nested array, so the check has to go there too.
    nested: {
      key: 'plans',
      required: ['plan', 'price_status', 'verified_at'],
      present: ['base_monthly_usd', 'included', 'notes'],
    },
  },
  {
    name: 'estimate_stack_cost',
    args: { stack: 'supabase,clerk,polar,vercel' },
    rows: (r) => r.services,
    required: ['service', 'plan', 'lines'],
    present: ['monthly_usd'],
    top: {
      // `monthly_total_usd` is `present`, not `required`: null is the CORRECT answer when a
      // service is unpriced, and demanding a number here would re-introduce the exact bug fixed
      // on 2026-08-13 — a total invented by treating an unpriceable line as zero.
      present: ['monthly_total_usd'],
      required: ['stack', 'users', 'unpriced_services'],
    },
  },
];

function checkKeys(obj, { required = [], present = [], absent = [] }, where) {
  const bad = [];
  for (const k of required) {
    if (!(k in obj)) bad.push(`${where}.${k} MISSING`);
    else if (obj[k] === null || obj[k] === undefined) bad.push(`${where}.${k} is null`);
  }
  for (const k of present) if (!(k in obj)) bad.push(`${where}.${k} MISSING`);
  for (const k of absent) if (k in obj) bad.push(`${where}.${k} SHOULD BE GONE`);
  return bad;
}

let failed = 0;
for (const c of CASES) {
  const label = c.label || c.name;
  const res = await client.callTool({ name: c.name, arguments: c.args });
  const data = JSON.parse(res.content[0].text);
  const rows = c.rows(data) || [];
  const problems = [];

  if (data.error) problems.push(`ERROR ${data.error}`);
  else if (rows.length === 0) problems.push('0 rows');
  else {
    problems.push(...checkKeys(rows[0], c, 'row'));
    if (c.top) problems.push(...checkKeys(data, c.top, 'top'));
    if (c.nested) {
      const inner = (rows[0][c.nested.key] || [])[0];
      if (!inner) problems.push(`row.${c.nested.key}[0] MISSING`);
      else problems.push(...checkKeys(inner, c.nested, `row.${c.nested.key}[0]`));
    }
  }

  if (problems.length) failed++;
  console.log(
    `${problems.length ? '✗' : '✓'} ${label.padEnd(30)} ${problems.length ? problems.join(' · ') : `${rows.length} row(s), fields intact`}`,
  );
}

await client.close();
console.log(failed ? `\n${failed}/${CASES.length} failed` : `\nall ${CASES.length} live, with their promised fields`);
process.exit(failed ? 1 : 0);
