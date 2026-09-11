# Where kynth-mcp and the ParseRail plugin are listed

Read live 2026-09-04. Most of this surface is already armed and watched by
`studio.compound.mcpdir.tick` (`compound-ops/portals/mcpdir/tick.mjs`, every 6 hours), this file
records state, it does not replace that job. Its own `state.json` is the live source; this is
a snapshot plus the two items that job does not cover.

## kynth-mcp (eleven free, keyless, read-only tools)

| Directory | State | URL |
| --- | --- | --- |
| npm | live, `0.4.0` | https://www.npmjs.com/package/kynth-mcp |
| Official MCP registry | live, **stale at `0.3.0`** (npm is `0.4.0`) | https://registry.modelcontextprotocol.io/v0/servers?search=studio.compound/kynth-mcp |
| Glama | PASS | https://glama.ai/mcp/servers/fhf0eohm9v |
| LobeHub | PASS | https://lobehub.com/mcp/kyisaiah47-kynth-mcp |
| mcpservers.org | PASS | https://mcpservers.org/search?query=kynth |
| mcp.so | UNRESOLVED, free route is a support ticket with no status surface, mcpdir job is chasing it | https://mcp.so/server/kynth-mcp/kyisaiah47 |
| PulseMCP | STALE, mcpdir job re-checks each tick | https://www.pulsemcp.com/servers?q=kynth |
| Cursor Directory (cursor.directory) | NOT SUBMITTED, see below | https://cursor.directory/mcp |
| Claude connectors directory | NOT PURSUED, see below | n/a |

## ParseRail plugin / @kynth/api-mcp (kynth-claude-plugin repo)

| Directory | State | URL |
| --- | --- | --- |
| Self-hosted marketplace (GitHub) | live | https://github.com/kyisaiah47/compound-claude-plugin |
| npm (`@kynth/api-mcp`) | live, `0.5.2`, published from the parserail repo, out of this repo's scope | https://www.npmjs.com/package/@kynth/api-mcp |
| Official MCP registry (`studio.compound/core`) | live, `0.5.2`, current | https://registry.modelcontextprotocol.io/v0/servers?search=studio.compound/core |
| Anthropic's official Claude Code plugin directory (github.com/anthropics/claude-plugins-official) | **submitted 2026-08-14, under review.** Tracked in `compound-ops/portals/mcpdir/tick.mjs`, the `HOLDS` list, under the pre-rename name "Kynth Core" and slug `kynth-core`. The plugin itself renamed to ParseRail 2026-09-04 (`marketplace.json` carries a `renames` migration); the submission's own answers were deliberately left on the old name per that file's own rule (renaming mid-review is worse than the inconsistency). The due date on that hold is 2026-09-04, today, worth a status check on the next mcpdir tick. | n/a, Console wizard, no public listing URL until approved |
| Claude connectors directory | NOT PURSUED, see below | n/a |
| Smithery, mcpmarket.com, n8n Creator Portal, Zapier, Gemini CLI gallery | covered by the mcpdir job for `studio.compound/core`, not duplicated here | see `compound-ops/portals/mcpdir/state.json` |

## Claude connectors directory: not pursued, for both

Read live 2026-09-04 (`platform.claude.com/docs/en/build-with-claude/mcp-connectors` and the
Anthropic Connectors Directory FAQ): submission needs a **Streamable HTTP** remote endpoint, a
public privacy policy URL, test credentials, and, per the standing memory
`claude-connectors-directory-requirements.md` (verified 2026-07-09, still current), an
**org account on Claude.ai Team/Enterprise**, since the submission/management dashboard lives
under `claude.ai/admin-settings/directory` and does not exist on an individual plan.

- **kynth-claude-plugin / ParseRail** is a local Claude Code plugin (stdio, `npx` at install
  time). It is not a remote connector at all: Claude Code plugins have no Anthropic-run
  submission registry (confirmed live from `code.claude.com/docs/en/plugin-marketplaces`:
  "Anthropic does not maintain a central submission registry"; distribution is
  self-hosted marketplaces, which this repo already is). The one Anthropic-run listing that
  does exist for plugins is the official plugin directory above, already submitted.
- **kynth-mcp** is keyless, so it does not carry the OAuth/billing conflict the memory
  documents for the paid ParseRail API (a shared bearer token would pool every connector
  user's calls onto one account's wallet, moot here, there is no wallet). It could
  technically qualify, but two things are missing that no code in this session can supply:
  (1) a public **Streamable HTTP** hosted instance, today `kynth-mcp --http` only runs
  locally, there is no deployed public URL; (2) a Claude.ai **Team/Enterprise** org account
  under Isaiah's login, which this session cannot check or create.
- Call: leave both alone. If Isaiah wants kynth-mcp in the connectors directory, the two
  prerequisites above are his to supply (a hosting decision, and his own account tier); once
  both exist this becomes a normal submission.

## Cursor Directory (cursor.directory): queued, not submitted

Free, third-party (not Anthropic- or Cursor-run), submission form at
`cursor.directory/mcp/submit` (rate-limited on the one live check this session made). Genuinely
uncovered by the mcpdir job. Its form is a plain web submission, the same shape as mcp.so and
mcpmarket.com, which the mcpdir job already drives through the shared `chromed` daemon and
session-login library (`compound-ops/portals/mcpdir/lib`, `emailsignin.mjs`). That plumbing lives
outside this repo's scope and this session had no daemon session to reuse it with, so rather
than hand-roll a second one-off browser script, this is left as a queued target for that job:
add a `run-cursor-directory.mjs` following the `run-mcpmarket.mjs` pattern (repo URL,
description, npm package `kynth-mcp`, no login required per the guide read live). Noted here so
nobody re-derives this research.
