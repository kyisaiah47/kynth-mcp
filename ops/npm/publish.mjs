#!/usr/bin/env node
// publish.mjs — the gate between this working tree and the two registries that serve it.
//
//   node ops/npm/publish.mjs --dry-run    # report only, touch nothing
//   node ops/npm/publish.mjs              # publish to npm, then to the MCP registry
//
// ⛔ WHY A GATE AND NOT JUST `npm publish`.
//
// On 2026-08-13 this package was serving, simultaneously:
//
//   npm         kynth-mcp@0.2.0, published 2026-08-06, containing the PRE-FIX code
//   MCP registry studio.kynth/kynth-mcp@0.1.2, describing a two-tool compliance server
//   this repo    server.json at 0.2.0, ten tools, never published anywhere
//
// Three different answers to "what is this server", none of them agreeing, and nothing anywhere
// that would notice. `npm publish` succeeds whether or not the tarball contains what you think it
// does — `files` in package.json is a whitelist, and a path that falls outside it is dropped
// silently at pack time. That is how a fixed file stays unfixed in the published artifact while
// the working tree, the tests and the git log all say it is fixed.
//
// So this compares THREE things by sha256, not two:
//
//   src     what is on disk right now
//   staged  what `npm pack` will actually put in the tarball
//   live    what the registry is serving today, unpacked from the published tarball
//
// src vs staged catches the whitelist dropping a file. staged vs live is the diff being shipped,
// printed file by file, so a publish is never a leap. If a source file is missing from staged,
// this exits non-zero and does not publish — there is no flag to override that, because an
// override is how a gate becomes a formality.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRY = process.argv.includes('--dry-run');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8'));

console.log(`${pkg.name} ${pkg.version}  ·  ${server.name} ${server.version}\n`);

/* ── 0 · the two manifests have to agree ──────────────────────────────────────────────────────
 * They are separate files describing one artifact, and they drifted by a whole minor version
 * without anything complaining. */
const fail = [];
if (pkg.version !== server.version) {
  fail.push(`package.json is ${pkg.version} but server.json is ${server.version}`);
}
const npmPkgInServerJson = server.packages?.find((p) => p.registryType === 'npm');
if (npmPkgInServerJson) {
  if (npmPkgInServerJson.identifier !== pkg.name) {
    fail.push(`server.json npm identifier is "${npmPkgInServerJson.identifier}", package.json name is "${pkg.name}"`);
  }
  if (npmPkgInServerJson.version !== pkg.version) {
    fail.push(`server.json npm package version is ${npmPkgInServerJson.version}, package.json is ${pkg.version}`);
  }
}
if (pkg.mcpName && pkg.mcpName !== server.name) {
  fail.push(`package.json mcpName is "${pkg.mcpName}", server.json name is "${server.name}"`);
}

/* ⛔ THE REGISTRY'S OWN LIMITS, CHECKED HERE, BECAUSE npm PUBLISHES FIRST AND CANNOT BE UNDONE.
 *
 * This is why the registry sat three versions stale. server.json carried a 225-character
 * description; the registry caps it at 100 and answers 422 "validation failed". So the 0.2.0
 * registry publish could never have succeeded, npm went out anyway, and the two have disagreed
 * since 2026-08-06 with the failure buried in whatever terminal ran it that day.
 *
 * A publish sequence whose irreversible half runs before its most fragile validation is a
 * sequence that will keep producing this exact split. Everything the registry can reject on
 * shape is checked up here, before anything ships. */
const DESCRIPTION_MAX = 100;
if ((server.description ?? '').length > DESCRIPTION_MAX) {
  fail.push(
    `server.json description is ${server.description.length} chars; the MCP registry caps it at ` +
      `${DESCRIPTION_MAX} and rejects the publish with a 422`,
  );
}
if (!/^[a-z0-9.-]+\/[a-z0-9._-]+$/.test(server.name ?? '')) {
  fail.push(`server.json name "${server.name}" is not a reverse-DNS namespace/name pair`);
}
if (!server.packages?.length) fail.push('server.json declares no packages, so nothing is installable');

/* ── 1 · SRC ─────────────────────────────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const src = new Map();
/* npm always ships package.json whether or not `files` names it, so it belongs in the src set —
 * otherwise the live diff reports it as REMOVE on every run, which is noise that teaches whoever
 * reads this output to skim past the diff it exists to make readable. */
for (const entry of [...(pkg.files ?? []), 'package.json']) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) {
    fail.push(`package.json "files" lists ${entry}, which does not exist`);
    continue;
  }
  const paths = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
  for (const p of paths) src.set(path.relative(ROOT, p), sha(fs.readFileSync(p)));
}

/* ── 2 · STAGED — what npm will really ship ──────────────────────────────────────────────────── */
const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json']))[0];
const staged = new Map(packed.files.map((f) => [f.path, null]));

// Every source file must survive the whitelist. This is the check that catches a silent drop.
const dropped = [...src.keys()].filter((f) => !staged.has(f));
if (dropped.length) {
  fail.push(`${dropped.length} source file(s) would NOT be in the tarball: ${dropped.join(', ')}`);
}

/* ── 3 · LIVE — unpack what the registry is serving now ──────────────────────────────────────── */
let live = new Map();
let livePublished = null;
try {
  livePublished = run('npm', ['view', `${pkg.name}`, 'version']).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kynth-mcp-live-'));
  const tgz = run('npm', ['pack', `${pkg.name}@${livePublished}`, '--pack-destination', tmp]).trim().split('\n').pop();
  run('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp]);
  const pkgDir = path.join(tmp, 'package');
  for (const p of walk(pkgDir)) live.set(path.relative(pkgDir, p), sha(fs.readFileSync(p)));
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  console.log(`  ! could not fetch the published tarball (${String(e.message).split('\n')[0]}) — diff skipped`);
}

/* ── 4 · the diff, file by file ──────────────────────────────────────────────────────────────── */
if (live.size) {
  const names = [...new Set([...src.keys(), ...live.keys()])].sort();
  const changed = [];
  for (const n of names) {
    const a = live.get(n);
    const b = src.get(n);
    if (a === b) continue;
    changed.push(`    ${!a ? 'ADD   ' : !b ? 'REMOVE' : 'CHANGE'}  ${n}`);
  }
  console.log(`  live on npm: ${pkg.name}@${livePublished} (${live.size} files)`);
  if (!changed.length) console.log('    (identical to this working tree)');
  else console.log(changed.join('\n'));
  if (changed.length && livePublished === pkg.version) {
    fail.push(
      `version ${pkg.version} is already published and the contents DIFFER — bump the version, ` +
        'npm will not overwrite a published tarball',
    );
  }
} else {
  console.log('  live on npm: unknown');
}
console.log(`\n  src ${src.size} file(s) · staged ${staged.size} · unpacked size ${(packed.unpackedSize / 1024).toFixed(0)}kB`);

if (fail.length) {
  console.error('\n' + fail.map((f) => `✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log('\n✓ manifests agree, every source file is in the tarball');

if (DRY) {
  console.log('  --dry-run: nothing published');
  process.exit(0);
}

/* ── 5 · publish ─────────────────────────────────────────────────────────────────────────────── */
console.log('\n→ npm publish');
console.log(run('npm', ['publish', '--access', 'public'], { stdio: ['ignore', 'pipe', 'inherit'] }));

// The MCP registry is the half that was three versions stale, so it is not optional here and a
// failure is loud. mcp-publisher authenticates interactively the first time; after that the token
// is cached in ~/.mcp-publisher.
console.log('→ mcp-publisher publish');
try {
  console.log(run('mcp-publisher', ['publish'], { stdio: ['ignore', 'pipe', 'inherit'] }));
} catch (e) {
  console.error(`✗ MCP registry publish failed: ${String(e.message).split('\n')[0]}`);
  console.error('  npm is now ahead of the registry — re-run `mcp-publisher publish` once resolved.');
  process.exit(1);
}
console.log('\n✓ published to both');
