// kynth-mcp — MCP server for Kynth Studios compliance lookups.
//
// Two tools, both backed by live public data:
//
//   lookup_ada_report(domain)       — ADA Title II website accessibility scan for a
//                                     US local-government domain, from the CivicBinder
//                                     Municipal Web Accessibility Index (cb_ada_scans,
//                                     read over PostgREST with the publishable key;
//                                     RLS exposes only completed scans).
//
//   lookup_nonprofit_status(ein)    — IRS auto-revocation + California registry
//                                     good-standing check for a nonprofit, via the
//                                     GoodStanding public lookup API.
//
// No credentials required. Read-only. Every request goes to public endpoints that
// serve the same data as the products' own web pages.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const CB_SITE = 'https://civicbinder.org';
const SB_URL = 'https://xowekqdsttxwbhfxvusa.supabase.co';
// Supabase publishable key — designed to ship in public clients; RLS scopes reads.
const SB_KEY = 'sb_publishable_9GvEPSkV3gyuyN02ZZJcig_gWo1j9LK';
const GS_API = 'https://goodstanding.kynth.studio/api/lookup';

const ADA_COLUMNS = [
  'domain', 'entity_name', 'entity_type', 'state', 'city', 'population', 'deadline',
  'url_scanned', 'scanned_at', 'axe_version', 'pages_scanned',
  'violations_total', 'violations_serious', 'violations_critical', 'top_rules', 'grade',
].join(',');

const GRADE_EXPLANATION = {
  A: 'no serious or critical failures detected',
  B: 'no critical failures and at most 2 serious ones',
  C: '10 or fewer serious-or-critical failures',
  D: 'between 11 and 25 serious-or-critical failures',
  F: 'more than 25 serious-or-critical failures',
};

const DEADLINE_LABEL = {
  '2027-04-26': 'April 26, 2027 (communities of 50,000+)',
  '2028-04-26': 'April 26, 2028 (smaller communities and special districts)',
};

const DOMAIN_RE = /^[a-z0-9][a-z0-9.-]{1,250}$/;

/** Strip protocol / www / path from whatever the caller pasted. */
function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#]/)[0];
  return d;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`upstream ${res.status}: ${body}`);
  }
  return res.json();
}

async function lookupAdaReport(rawDomain) {
  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN_RE.test(domain)) {
    return { found: false, error: `"${rawDomain}" does not look like a domain name.` };
  }
  const rows = await fetchJson(
    `${SB_URL}/rest/v1/cb_ada_scans?status=eq.scanned&domain=eq.${encodeURIComponent(domain)}&select=${ADA_COLUMNS}&limit=1`,
    { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  );
  const row = rows[0];
  if (!row) {
    return {
      found: false,
      domain,
      message:
        `${domain} is not in the CivicBinder Municipal Web Accessibility Index yet. ` +
        `The index covers scanned US local-government .gov websites. ` +
        `Browse the full index at ${CB_SITE}/ada or the open dataset at ${CB_SITE}/ada/dataset.json.`,
    };
  }
  return {
    found: true,
    domain: row.domain,
    entity_name: row.entity_name,
    entity_type: row.entity_type,
    city: row.city,
    state: row.state,
    population: row.population,
    grade: row.grade,
    grade_meaning: GRADE_EXPLANATION[row.grade] || null,
    violations_total: row.violations_total,
    violations_serious: row.violations_serious,
    violations_critical: row.violations_critical,
    top_rules: row.top_rules,
    ada_title_ii_deadline: row.deadline,
    deadline_label: DEADLINE_LABEL[row.deadline] || row.deadline,
    url_scanned: row.url_scanned,
    scanned_at: row.scanned_at,
    axe_version: row.axe_version,
    pages_scanned: row.pages_scanned,
    report_url: `${CB_SITE}/ada/${row.domain}`,
  };
}

async function lookupNonprofitStatus(rawEin) {
  const digits = String(rawEin || '').replace(/\D/g, '');
  if (digits.length !== 9) {
    return { error: `"${rawEin}" is not a valid EIN. An EIN has 9 digits, e.g. 12-3456789.` };
  }
  const data = await fetchJson(`${GS_API}?q=${digits}`);
  if (data.clear) {
    return {
      ein: digits,
      clear: true,
      message:
        `EIN ${digits} does not appear on the IRS auto-revocation list or the ` +
        `California registry delinquency/suspension lists that GoodStanding tracks. ` +
        `On those lists, this organization reads as in good standing. ` +
        `Full check: https://goodstanding.kynth.studio/#lookup`,
    };
  }
  return {
    ein: digits,
    clear: false,
    results: data.results,
    lookup_url: 'https://goodstanding.kynth.studio/#lookup',
  };
}

/** Build the McpServer with both tools registered. One instance per connection. */
export function buildServer() {
  const server = new McpServer({
    name: 'kynth-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'lookup_ada_report',
    {
      title: 'Look up an ADA Title II website accessibility report',
      description:
        'Look up a US local-government (.gov) domain in the CivicBinder Municipal Web ' +
        'Accessibility Index. Returns the accessibility grade (A-F), WCAG 2.1 AA violation ' +
        'counts from an axe-core scan, the failing rules, the entity\'s ADA Title II ' +
        'compliance deadline (April 2027 or April 2028), and a link to the full public ' +
        'report page. Use for questions like "is cityofx.gov ADA compliant" or "how ' +
        'accessible is this county website".',
      inputSchema: {
        domain: z
          .string()
          .describe('The .gov domain to look up, e.g. "denvergov.org" or "cityofmadison.com". Protocol and paths are stripped automatically.'),
      },
    },
    async ({ domain }) => {
      const result = await lookupAdaReport(domain);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    'lookup_nonprofit_status',
    {
      title: 'Look up nonprofit IRS / California good standing by EIN',
      description:
        'Check a US nonprofit\'s standing by EIN against the IRS auto-revocation list ' +
        '(tax-exempt status revoked for three consecutive missed Form 990 filings) and ' +
        'California Registry of Charities delinquency/suspension lists. Returns revocation ' +
        'and reinstatement dates, whether the streamlined 15-month reinstatement window is ' +
        'still open, and whether AB 488 requires fundraising platforms to block donations. ' +
        'A "clear" result means the EIN is on none of the tracked lists.',
      inputSchema: {
        ein: z
          .string()
          .describe('The organization\'s 9-digit EIN, with or without a dash, e.g. "12-3456789".'),
      },
    },
    async ({ ein }) => {
      const result = await lookupNonprofitStatus(ein);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  return server;
}
