#!/usr/bin/env node
// sync-manifest.mjs — regenerate lhm.plugin.json's tool list from the server that actually runs,
// and fail closed when the prose that quotes the tool count has fallen behind it.
//
//   node ops/lhm/sync-manifest.mjs --check   # report only, exit non-zero on any drift
//   node ops/lhm/sync-manifest.mjs           # rewrite the manifest, then report
//
// ⛔ WHY THIS EXISTS. On 2026-08-14 this repo was serving three different answers to "how many
// tools does kynth-mcp have":
//
//   tools/list on the built server   ELEVEN
//   README.md, first line            "Eleven read-only lookup tools"
//   lhm.plugin.json .tools           TEN — compare_app_builders, added in 0.3.0, was never
//                                    appended, while the same file's .description said "eleven"
//
// LobeHub renders that manifest. So the one artifact a directory actually reads was the one
// carrying the wrong count, and every check upstream of it — the README, the description, the
// version — agreed with each other and not with the file that shipped. Nothing errored. The
// listing simply told buyers about ten tools.
//
// A hand-maintained copy of a list the server already knows is a copy that drifts. This derives
// it, so adding a tool cannot leave the manifest behind. The number-word check is here for the
// same reason: "eleven" appears in prose in two places, and prose does not have a test.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'lhm.plugin.json');
const README = path.join(ROOT, 'README.md');
const CHECK = process.argv.includes('--check');

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty',
];

/** tools/list against the server as it is on disk — the only source that cannot be stale. */
function liveTools() {
  const bin = path.join(ROOT, 'bin', fs.readdirSync(path.join(ROOT, 'bin'))[0]);
  const req =
    [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sync-manifest","version":"1"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    ].join('\n') + '\n';
  const r = spawnSync('node', [bin], { input: req, encoding: 'utf8', timeout: 120000 });
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.id === 2 && j.result?.tools) return j.result.tools;
    } catch {}
  }
  throw new Error(`tools/list returned nothing usable. stderr: ${(r.stderr || '').slice(0, 400)}`);
}

const tools = liveTools();
const count = tools.length;
const word = WORDS[count];
if (!word) throw new Error(`${count} tools — extend WORDS in this file`);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const problems = [];
const before = JSON.stringify(manifest.tools);
// The manifest carries exactly what the server advertises, in the server's own order.
manifest.tools = tools.map((t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.inputSchema,
  ...(t.execution ? { execution: t.execution } : {}),
}));
if (before !== JSON.stringify(manifest.tools)) {
  problems.push(
    `lhm.plugin.json .tools disagreed with tools/list (had ${JSON.parse(before).length}, server has ${count})`,
  );
}
if (manifest.version !== pkgVersion) {
  problems.push(`lhm.plugin.json .version ${manifest.version} != package.json ${pkgVersion}`);
  manifest.version = pkgVersion;
}

// ⛔ The prose count. A directory renders the description verbatim, so a wrong word here is a
// wrong listing even when every machine-readable field is right.
const wrongWord = new RegExp(`\\b(${WORDS.filter((w) => w !== word).join('|')})\\b[^.]{0,24}(read-only|lookup)`, 'i');
for (const [label, text] of [
  ['lhm.plugin.json .description', manifest.description],
  ['README.md', fs.readFileSync(README, 'utf8').split('\n').slice(0, 6).join('\n')],
]) {
  const hit = text.match(wrongWord);
  if (hit) problems.push(`${label} says "${hit[0]}" — the server has ${count} (${word})`);
  else if (!new RegExp(`\\b${word}\\b`, 'i').test(text)) {
    problems.push(`${label} never says "${word}" — it should quote the ${count}-tool count`);
  }
}

if (!CHECK) fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`tools/list = ${count} (${word})`);
console.log(`manifest   = ${manifest.tools.length} tools @ ${manifest.version}`);
for (const p of problems) console.log(`  ⚠ ${p}`);
if (!problems.length) console.log('  manifest, README and the running server agree');
// In --check this is a gate. In write mode the .tools and .version drift is now repaired on
// disk, but prose it cannot rewrite still fails — a human sentence is not a field to generate.
const fatal = CHECK ? problems : problems.filter((p) => /says|never says/.test(p));
process.exit(fatal.length ? 1 : 0);
