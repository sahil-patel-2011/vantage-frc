# Team-shared agent configuration

A team authors its coding-agent setup **once** at `/team/agent-config` — rules,
reusable subagent definitions, MCP server entries, permission snippets, and
skills — and every member's agent consumes it:

| Consumer | How |
| --- | --- |
| Claude Code | `vantage-cad agent sync` in the repo (below) |
| Any custom agent | `GET /api/agent-config/bundle` (typed JSON, below) |
| Vantage in-app agent | automatic — valid `rules` items are injected into every AI run as a labeled context source |

## Item kinds and their real formats

Validation happens in `apps/web/lib/agent-config/formats.ts` (pure, tested).
Invalid content still saves (never lose a draft) but is flagged
`format_valid=false`, badged in the UI, and **excluded from every bundle**.

- **rules** — plain markdown appended to agent context / imported into
  CLAUDE.md. Non-empty, ≤32768 chars per item.
- **subagent** — a Claude Code `.claude/agents/<name>.md` file: YAML
  frontmatter with required `name` (lowercase+hyphens) and `description`,
  optional `tools` (comma-separated string or list) and `model`, then the
  system-prompt body.
- **mcp-server** — one `.mcp.json` `mcpServers` entry:
  `{"command", "args"?, "env"?}` (stdio) or `{"url", "headers"?}` (remote).
  **Env/header values are not secret storage** — entries whose values look
  like real credentials are refused; use `${PLACEHOLDER}` values that each
  member sets in their own local environment.
- **permissions** — the `settings.json` `permissions` shape:
  `{"allow"?: [...], "deny"?: [...], "ask"?: [...]}` of rule strings like
  `Bash(./gradlew build)` or `mcp__server__tool`.
- **skill** — SKILL.md format: frontmatter `{name, description}` + body.

Every save increments `version` and appends an `agent_config_revisions` row;
the UI can restore any revision (restore = a new version, history intact).
Members can read everything; writes need owner/admin, or any member when the
org enables **allow member edits**.

## Claude Code sync

```sh
vantage-cad agent sync [--dir <repo>] [--dry-run]
```

Authenticates with the device token paired by `vantage-cad setup` and writes:

- `.claude/agents/<name>.md` — one file per subagent
- `.claude/skills/<name>/SKILL.md` — one folder per skill
- `.claude/vantage-team-rules.md` — concatenated rules
- `CLAUDE.md` — an `@.claude/vantage-team-rules.md` import line **only**
  between `<!-- BEGIN VANTAGE TEAM AGENT CONFIG -->` / `<!-- END ... -->`
  markers. Idempotent: re-sync replaces the marked block, never duplicates,
  never touches anything outside the markers.
- `.mcp.json` — deep-merged. Only keys under the `vantage-` prefix are
  added, updated, or pruned; a team's other servers are never modified.
- `.claude/vantage-permissions.suggested.json` — permissions are a security
  change, so they are **never** merged into `.claude/settings.json`
  automatically; the CLI prints an instruction and a human applies them.

The command prints a per-file summary (`written` / `updated` / `unchanged` /
`skipped`); `--dry-run` previews without writing.

## Bundle export for custom agents

```
GET /api/agent-config/bundle            # browser session; optional ?orgId=
GET /api/agent-config/bundle            # or Authorization: Bearer <device token>
```

Only format-valid items are included. Response shape
(`vantage.agent-config/v1`):

```jsonc
{
  "schema": "vantage.agent-config/v1",
  "orgId": "…uuid…",
  "generatedAt": "2026-08-24T00:00:00.000Z",
  "rules":      [{ "name": "units", "description": null, "markdown": "…", "version": 3 }],
  "subagents":  [{ "name": "drivetrain-reviewer", "description": "…", "markdown": "---\nname: …", "version": 1 }],
  "mcpServers": [{ "name": "github", "description": null, "version": 2,
                   "entry": { "command": "npx", "args": ["-y", "…"], "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" } } }],
  "permissions":[{ "name": "gradle", "description": null, "version": 1,
                   "snippet": { "allow": ["Bash(./gradlew build)"] } }],
  "skills":     [{ "name": "match-strategy-notes", "description": "…", "markdown": "---\nname: …", "version": 1 }]
}
```

`mcpServers[].entry` is normalized to the bare entry (a pasted
`{"mcpServers": {"name": {...}}}` wrapper is unwrapped at validation time).

## In-app agent injection

`packages/agent/src/org-agent-rules.ts` loads the org's valid `rules` items
(`to_regclass`-guarded — deployments without migration 0487 just get nothing)
and injects them into `AIOrchestrator.run` as a context source labeled
"Team agent rules — set by your team at /team/agent-config", bounded to
16000 characters. Because it is a normal context source, run provenance
(`ai_runs.context_sources`) records that the rules were used.

## Storage

Migration `packages/db/migrations/0487_agent_config.sql`: `agent_config_items`
(+ per-org+kind unique names, `format_valid`, incrementing `version`),
append-only `agent_config_revisions`, and `agent_config_settings`
(`allow_member_edits`). All org-scoped with RLS; members read, editors write
via `can_edit_agent_config(org_id)`.
