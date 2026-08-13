// kynth-mcp — the directory tools.
//
// The compliance lookups in server.js answer a question a person already knew they had.
// These answer questions an AGENT has mid-task, which is a different and much larger surface:
// "which skill does this", "is this component in a registry", "which model is cheapest for
// this now", "is this library still maintained". Every one of them is a real lookup an agent
// currently resolves by guessing from training data or by scraping a search page.
//
// All seven are read-only GETs against endpoints that already serve the products' own pages,
// with no key and no signup. Responses are trimmed hard before they leave this file — an
// agent's context is the scarce resource, and /api/leaderboard alone is 119KB of JSON.

import { z } from 'zod';

const API = {
  rulestack: 'https://rulestack.kynth.studio/api',
  skillworks: 'https://skillworks.kynth.studio/api',
  blockdex: 'https://blockdex.kynth.studio/api',
  tooldrift: 'https://tooldrift.kynth.studio/api',
  stillshipping: 'https://stillshipping.kynth.studio/api',
  kitgrade: 'https://kitgrade.kynth.studio/api',
  stacktab: 'https://stacktab.kynth.studio/api',
};

/** Cap on rows returned to a caller. Above this the answer stops being an answer. */
const MAX_ROWS = 10;

/** ⛔ EVERY REQUEST GETS A DEADLINE. An `await fetch` with no `signal` never settles when the
 *  socket dies, and all eight directory tools sit behind this one call — so a single dead upstream
 *  would hang the MCP client with no error and stall the agent mid-turn, which is the worst
 *  failure available to a tool something is waiting on. Same class as the three shared libraries
 *  this estate fixed on 2026-08-13. The rejection lands in the tool() wrapper below, which already
 *  turns an upstream failure into a readable `{ error }` rather than a protocol error. */
const TIMEOUT_MS = Number(process.env.KYNTH_MCP_TIMEOUT_MS || 10_000);

async function get(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`);
  return res.json();
}

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

const clamp = (n) => Math.min(Math.max(Number(n) || 5, 1), MAX_ROWS);

/**
 * Register a tool whose handler returns a plain object.
 *
 * Every tool returns both `content` (the text an older client reads) and `structuredContent`
 * (what a client that supports it parses), and every one catches its own upstream failure and
 * returns it as data. A tool that throws makes the whole call look broken to the agent; a tool
 * that returns `{ error }` lets it try something else, which for a directory lookup is almost
 * always the right outcome.
 */
function tool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    let result;
    try {
      result = await handler(args);
    } catch (e) {
      result = { error: String(e?.message || e) };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  });
}

export function registerDirectoryTools(server) {
  // ── RuleStack ────────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'search_agent_configs',
    {
      title: 'Search real AGENTS.md / CLAUDE.md files from public repositories',
      description:
        'Search RuleStack, an index of real agent instruction files (AGENTS.md, CLAUDE.md, ' +
        'Cursor rules, Copilot instructions, Windsurf, GEMINI.md, Cline) harvested from public ' +
        'GitHub repositories and scored for quality. Use when writing or reviewing an agent ' +
        'config and you want to see how well-maintained projects with a given stack actually ' +
        'write theirs — "show me CLAUDE.md files from Next.js repos", "what do good AGENTS.md ' +
        'files put in their build section".',
      inputSchema: {
        stack: z.string().optional().describe('Comma-separated stack slugs, ANDed. e.g. "nextjs,typescript".'),
        format: z.string().optional().describe('Comma-separated format slugs: agents-md, claude-md, cursor-rules, copilot-instructions, windsurf-rules, gemini-md, cline-rules.'),
        tag: z.string().optional().describe('Comma-separated section tags, ANDed: build, test, security, code-style, architecture, git-pr, do-not, docs.'),
        min_quality: z.number().optional().describe('Minimum quality score, 0-100.'),
        limit: z.number().optional().describe('How many to return, 1-10. Default 5.'),
      },
    },
    async ({ stack, format, tag, min_quality, limit }) => {
      const d = await get(`${API.rulestack}/configs?${qs({ stack, format, tag, min_quality, limit: clamp(limit), sort: 'quality' })}`);
      return {
        total: d.pagination?.total ?? d.configs?.length ?? 0,
        configs: (d.configs || []).map((c) => ({
          repo: c.repo_full_name,
          format: c.format,
          path: c.path,
          url: c.html_url,
          quality: c.quality,
          words: c.body_words,
          covers: c.section_tags,
          stacks: c.stacks?.slice(0, 8),
          commands: c.commands?.slice(0, 6),
        })),
        browse: 'https://rulestack.kynth.studio/configs',
      };
    },
  );

  // ── SkillWorks ───────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'search_agent_skills',
    {
      title: 'Search published Claude Code skills, plugins and marketplaces',
      description:
        'Search SkillWorks, an index of publicly published agent skills, plugins and skill ' +
        'marketplaces, ranked by installs and repository signal. Use before writing a skill ' +
        'from scratch to check whether one already exists, or when a user asks "is there a ' +
        'skill for X" / "what should I install for Y". Returns the install command for each ' +
        'result, so the answer is directly actionable.',
      inputSchema: {
        q: z.string().describe('What the skill should do, in plain words. e.g. "pdf generation", "code review", "terraform".'),
        kind: z.string().optional().describe('Filter to one of: skill, plugin, marketplace.'),
        limit: z.number().optional().describe('How many to return, 1-10. Default 5.'),
      },
    },
    async ({ q, kind, limit }) => {
      const d = await get(`${API.skillworks}/list?${qs({ q, kind, limit: clamp(limit) })}`);
      return {
        query: q,
        results: (d.rows || []).map((r) => ({
          name: r.name,
          kind: r.kind,
          repo: r.repo_full_name,
          description: r.description,
          install: r.install_command,
          installs: r.installs,
          stars: r.stars,
          score: r.score,
          url: r.url,
        })),
        browse: 'https://skillworks.kynth.studio',
      };
    },
  );

  // ── BlockDex ─────────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'search_component_registries',
    {
      title: 'Search shadcn-style component registries',
      description:
        'Search BlockDex, a cross-registry index of shadcn-compatible components, blocks, hooks ' +
        'and libraries from dozens of public registries. Use when a user wants a UI component ' +
        'and you would otherwise hand-write it — "is there a date range picker block", "which ' +
        'registries have a kanban board". Returns the registry, the item type and its ' +
        'dependencies so you can judge the cost of pulling it in.',
      inputSchema: {
        q: z.string().describe('What the component does. e.g. "data table", "auth form", "kanban".'),
        kind: z.string().optional().describe('Filter by item kind, e.g. "ui", "block", "hook", "lib".'),
        limit: z.number().optional().describe('How many to return, 1-10. Default 5.'),
      },
    },
    async ({ q, kind, limit }) => {
      const d = await get(`${API.blockdex}/search?${qs({ q, kind, limit: clamp(limit) })}`);
      return {
        query: q,
        total: d.total,
        items: (d.items || []).map((i) => ({
          name: i.name,
          title: i.title,
          registry: i.registry_name,
          type: i.type,
          description: i.description,
          dependencies: i.dependencies?.slice(0, 8),
          files: i.file_count,
        })),
        browse: 'https://blockdex.kynth.studio',
      };
    },
  );

  // ── ToolDrift ────────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'compare_ai_models',
    {
      title: 'Compare current AI model pricing and rankings',
      description:
        'Read ToolDrift, which tracks AI model pricing and which models the major AI-powered ' +
        'apps actually route to, sampled nightly. Use when asked which model to use, what a ' +
        'model costs now, or what changed recently — model pricing moves faster than any ' +
        'training cutoff, so answering from memory is reliably wrong.',
      inputSchema: {
        board: z
          .string()
          .optional()
          .describe(
            'Which ranking to read, as "scope/key". Budget bands: budget/free, budget/value, ' +
            'budget/balanced, budget/premium. Per-tool routing: tool/claude-code, tool/codex-cli, ' +
            'tool/cline, tool/aider, tool/roo-code, tool/kilo-code. Default overall/all.',
          ),
        limit: z.number().optional().describe('How many models to return, 1-10. Default 10.'),
      },
    },
    async ({ board, limit }) => {
      const d = await get(`${API.tooldrift}/leaderboard`);
      const want = (board || 'overall/all').toLowerCase();
      const boards = d.boards || [];
      const picked = boards.find((b) => `${b.scope}/${b.scope_key}`.toLowerCase() === want) || boards[0];
      if (!picked) return { error: 'leaderboard returned no boards', browse: 'https://tooldrift.kynth.studio' };
      return {
        board: `${picked.scope}/${picked.scope_key}`,
        captured_on: d.captured_on ?? null,
        method: d.method ?? null,
        available_boards: boards.map((b) => `${b.scope}/${b.scope_key}`),
        models: (picked.rows || []).slice(0, clamp(limit)).map((m) => ({
          rank: m.rank,
          model: m.model_id,
          score: m.score,
          blended_usd_per_mtok: m.price_blended_per_m,
          price_band: m.evidence?.band ?? null,
          // Adoption, not capability — the rationale says so and it should travel with the row,
          // because "ranked #1" read without it is a much stronger claim than the data supports.
          rationale: m.rationale,
        })),
        browse: 'https://tooldrift.kynth.studio',
      };
    },
  );

  // ── StillShipping ────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'check_project_maintenance',
    {
      title: 'Check whether a developer tool is still maintained',
      description:
        'Read StillShipping, which tracks whether developer tools and libraries are still ' +
        'actively shipping — last release, last commit, and whether the project reads as dead. ' +
        'Use before recommending a dependency. A library that was healthy at training time may ' +
        'have been abandoned since, and this is the check that catches it.',
      inputSchema: {
        q: z.string().optional().describe('Tool or library name to look up. Omit to list recently-declared-dead projects.'),
        limit: z.number().optional().describe('How many to return, 1-10. Default 5.'),
      },
    },
    async ({ q, limit }) => {
      const d = await get(`${API.stillshipping}/${q ? 'tools' : 'dead'}?${qs({ q, limit: clamp(limit) })}`);
      const rows = d.tools || d.rows || d.dead || (Array.isArray(d) ? d : []);
      return {
        query: q || '(recently declared dead)',
        /* ⛔ THESE KEYS DID NOT EXIST UPSTREAM, so JSON.stringify dropped them and the tool
         * answered with less than its description promised. The row StillShipping actually
         * serves (keys read off /api/tools on 2026-08-13) carries `verdict`, `pushed_at`,
         * `homepage` and `repo_full_name` — not status / last_commit / url. So the field this
         * tool exists for, the dead-or-alive VERDICT, was the one silently missing. */
        results: rows.slice(0, clamp(limit)).map((t) => ({
          name: t.name || t.slug,
          status: t.verdict,
          last_release: t.last_release_at,
          last_commit: t.pushed_at,
          stars: t.stars,
          url: t.homepage || (t.repo_full_name ? `https://github.com/${t.repo_full_name}` : null),
        })),
        browse: 'https://stillshipping.kynth.studio',
      };
    },
  );

  // ── KitGrade ─────────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'grade_starter_kit',
    {
      title: 'Look up a graded SaaS/Next.js starter kit',
      description:
        'Read KitGrade, which installs and grades public starter kits and boilerplates — what ' +
        'is actually wired up (auth, billing, email, tests), what only appears in the README, ' +
        'and how fresh the dependencies are. Use when someone asks which starter to build on.',
      inputSchema: {
        q: z.string().optional().describe('Kit name to look up. Omit for the top-graded kits.'),
        limit: z.number().optional().describe('How many to return, 1-10. Default 5.'),
      },
    },
    async ({ q, limit }) => {
      /* ⛔ KITGRADE'S LIST ENDPOINT IGNORES `q`. Verified 2026-08-13 with q, search, slug and
       * name: all four return total 34 and the identical top five, so asking for "shipfast"
       * answered with Bullet Train — a confidently wrong answer, which for an agent tool is worse
       * than an empty one. The per-slug route does work (`/api/kits/shipfast` returns ShipFast),
       * so a named request goes there first and falls back to the list when the slug is unknown. */
      const slug = String(q || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let rows = [];
      if (slug) {
        try {
          const one = await get(`${API.kitgrade}/kits/${encodeURIComponent(slug)}`);
          const kit = one.kit || one;
          if (kit && (kit.slug || kit.name)) rows = [kit];
        } catch {
          /* unknown slug — fall through to the list, which is still a useful answer */
        }
      }
      if (!rows.length) {
        const d = await get(`${API.kitgrade}/kits?${qs({ q, limit: clamp(limit) })}`);
        rows = d.kits || d.rows || (Array.isArray(d) ? d : []);
      }
      return {
        query: q || '(top graded)',
        /* ⛔ SAME CLASS: a tool named grade_starter_kit returned no grade. KitGrade's row (keys
         * read off /api/kits on 2026-08-13) has `evidence_level`, `coverage`, `repo` and
         * `homepage` — there is no `grade`, no `verified_features` and no `url`, so three of the
         * six fields resolved to undefined and vanished. `evidence_level` is the real grade: it
         * says whether the kit was installed and run or only read. */
        kits: rows.slice(0, clamp(limit)).map((k) => ({
          name: k.name || k.slug,
          grade: k.evidence_level,
          score: k.score,
          stack: k.stack,
          coverage: k.coverage,
          price: k.price_label,
          url: k.homepage || (k.repo ? `https://github.com/${k.repo}` : null),
        })),
        browse: 'https://kitgrade.kynth.studio',
      };
    },
  );

  // ── StackTab ─────────────────────────────────────────────────────────────────────────────
  tool(
    server,
    'lookup_service_pricing',
    {
      title: 'Look up current published pricing for a SaaS service',
      description:
        'Read StackTab, which re-checks the published pricing of the services a product runs ' +
        /* Four categories, not six. StackTab's live catalogue (fetched 2026-08-13) serves 29
         * services across auth, database, hosting and payments — there is no email category and
         * no analytics category, so an agent asking for either got an empty result that reads as
         * "this service has no pricing" rather than "we do not cover that". */
        'on (auth, database, hosting, payments) and records when each plan ' +
        'was last verified against the vendor\'s own page. Use when asked what something costs ' +
        'or what its free tier includes. Prices and free-tier limits change often enough that a ' +
        'remembered figure is a guess; each plan here carries the date it was last checked.',
      inputSchema: {
        category: z.string().optional().describe('Filter by category: "auth", "database", "hosting" or "payments".'),
        /* `resend` was the documented example and is not in the catalogue — the example a reader
         * copies first has to be one that returns something. */
        service: z.string().optional().describe('A specific service slug or name, e.g. "clerk", "neon", "stripe".'),
      },
    },
    async ({ category, service }) => {
      const d = await get(`${API.stacktab}/catalogue`);
      const needle = String(service || '').toLowerCase();
      const rows = (d.services || []).filter(
        (s) =>
          (!category || s.category?.toLowerCase() === category.toLowerCase()) &&
          (!needle || s.slug?.toLowerCase().includes(needle) || s.name?.toLowerCase().includes(needle)),
      );
      return {
        filters: { category: category || null, service: service || null },
        categories: [...new Set((d.services || []).map((s) => s.category))].sort(),
        services: rows.slice(0, MAX_ROWS).map((s) => ({
          service: s.slug,
          name: s.name,
          category: s.category,
          tagline: s.tagline,
          pricing_url: s.pricing_url,
          plans: (s.plans || []).map((p) => ({
            plan: p.name,
            base_monthly_usd: p.base_monthly_usd,
            included: p.included,
            notes: p.notes,
            // `price_status` distinguishes a published number from an inferred one, and
            // `verified_at` is when a human-visible pricing page last agreed with it. Both
            // travel with the price or the price is just a number with a date on it.
            price_status: p.price_status,
            verified_at: p.verified_at,
          })),
        })),
        browse: 'https://stacktab.kynth.studio',
      };
    },
  );

  tool(
    server,
    'estimate_stack_cost',
    {
      title: 'Estimate the monthly bill for a named stack at a given scale',
      description:
        'Price a whole stack at a chosen user count using StackTab\'s verified plan data. ' +
        'Returns the plan each service lands on and an itemised bill — which lines are included ' +
        'in the base fee and which are metered overages. Use when someone asks "what will this ' +
        'cost at N users" instead of estimating from memory.',
      inputSchema: {
        stack: z.string().describe('Comma-separated service slugs, e.g. "supabase,clerk,polar,vercel". Look them up with lookup_service_pricing.'),
        users: z.number().optional().describe('Monthly active users to price at. Default 10,000.'),
      },
    },
    async ({ stack, users }) => {
      const d = await get(`${API.stacktab}/estimate?${qs({ stack, users })}`);
      if (d.error) return { error: d.error, browse: 'https://stacktab.kynth.studio' };
      const picks = d.at?.picks || [];
      return {
        stack: d.stack,
        unknown_services: d.unknown_services,
        users: d.at?.users,
        monthly_total_usd: picks.reduce((n, p) => n + (p.total || 0), 0),
        services: picks.map((p) => ({
          service: p.serviceName || p.service,
          plan: p.planName || p.plan,
          monthly_usd: p.total,
          lines: (p.lines || []).map((l) => ({ label: l.label, detail: l.detail, usd: l.amount })),
        })),
        browse: 'https://stacktab.kynth.studio',
      };
    },
  );
}
