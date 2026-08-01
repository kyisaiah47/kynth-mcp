# kynth-mcp

MCP server for [Kynth Studios](https://kynth.studio) compliance lookups. Two read-only tools backed by live public data — no API key, no signup.

`mcp-name: io.github.kyisaiah47/kynth-mcp`

## Tools

### `lookup_ada_report(domain)`

Looks up a US local-government domain in the [CivicBinder Municipal Web Accessibility Index](https://civicbinder.org/ada) — axe-core scans of local-government .gov websites, graded A–F against WCAG 2.1 AA ahead of the ADA Title II deadlines (April 26, 2027 for communities of 50,000+; April 26, 2028 for smaller communities and special districts).

Returns the grade, violation counts (total / serious / critical), the top failing rules, the entity's deadline, and the public report page (`https://civicbinder.org/ada/<domain>`). The full index is also published as an open dataset at [civicbinder.org/ada/dataset.json](https://civicbinder.org/ada/dataset.json).

### `lookup_nonprofit_status(ein)`

Checks a nonprofit's EIN against the IRS auto-revocation list and the California Registry of Charities delinquency/suspension lists, via [GoodStanding](https://goodstanding.kynth.studio). Returns revocation and reinstatement dates, whether the streamlined 15-month reinstatement window is still open, and whether AB 488 requires charitable fundraising platforms to block the organization's donation pages. A `clear: true` result means the EIN is on none of the tracked lists.

## Install

```sh
npm install -g kynth-mcp
```

Or run without installing: `npx -y kynth-mcp`

## Run

```sh
kynth-mcp                # stdio (for MCP clients)
kynth-mcp --http 8974    # streamable HTTP on http://localhost:8974/mcp
```

## Claude Code

```sh
claude mcp add kynth -- npx -y kynth-mcp
```

## Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "kynth": {
      "command": "npx",
      "args": ["-y", "kynth-mcp"]
    }
  }
}
```

## Example

> Is the city website at 36thdistrictcourtmi.gov ADA compliant?

`lookup_ada_report("36thdistrictcourtmi.gov")` →

```json
{
  "found": true,
  "domain": "36thdistrictcourtmi.gov",
  "entity_name": "36th District Court",
  "grade": "A",
  "violations_total": 0,
  "ada_title_ii_deadline": "2027-04-26",
  "report_url": "https://civicbinder.org/ada/36thdistrictcourtmi.gov"
}
```

## License

MIT © Kynth Studios
