/**
 * Pure format model for team-shared agent configuration.
 *
 * Each kind maps to a REAL artifact consumed by coding agents:
 * - rules        → markdown imported into CLAUDE.md context
 * - subagent     → .claude/agents/<name>.md (YAML frontmatter + system prompt)
 * - mcp-server   → one entry under mcpServers in .mcp.json
 * - permissions  → the settings.json permissions.allow/deny/ask array shape
 * - skill        → SKILL.md-style frontmatter {name, description} + body
 *
 * Validators never throw: they return { ok, problems } so the UI can show
 * every problem and still save the draft (format_valid=false rows are
 * excluded from sync bundles).
 */

export type AgentConfigKind = "rules" | "subagent" | "mcp-server" | "permissions" | "skill";

export const AGENT_CONFIG_KINDS: AgentConfigKind[] = [
  "rules",
  "subagent",
  "mcp-server",
  "permissions",
  "skill",
];

export type ValidationResult = { ok: boolean; problems: string[] };

/** Item names become filenames (.claude/agents/<name>.md) and mcp key suffixes. */
export const AGENT_CONFIG_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const MAX_CONTENT_CHARS = 65536; // mirrors the DB CHECK
export const MAX_RULES_ITEM_CHARS = 32768;

export const VANTAGE_BEGIN_MARKER = "<!-- BEGIN VANTAGE TEAM AGENT CONFIG -->";
export const VANTAGE_END_MARKER = "<!-- END VANTAGE TEAM AGENT CONFIG -->";

export function validateAgentConfigName(name: string): ValidationResult {
  if (AGENT_CONFIG_NAME.test(name)) return { ok: true, problems: [] };
  return {
    ok: false,
    problems: [
      "Name must be 1-64 lowercase letters, digits, or hyphens (it becomes a filename and an mcp key), e.g. drivetrain-reviewer.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Frontmatter (subagent + skill)
// ---------------------------------------------------------------------------

export type FrontmatterParse = {
  ok: boolean;
  fields: Record<string, string | string[]>;
  body: string;
  problems: string[];
};

/**
 * Minimal YAML-frontmatter parser for the subset agent files actually use:
 * `key: value`, quoted values, block lists (`- item`), and folded/literal
 * scalars (`>-`, `>`, `|`) as seen in real SKILL.md files. Not a YAML engine —
 * anything fancier is reported as a problem instead of being mis-parsed.
 */
export function parseFrontmatter(content: string): FrontmatterParse {
  const problems: string[] = [];
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      ok: false,
      fields: {},
      body: normalized,
      problems: ["File must start with a `---` YAML frontmatter block."],
    };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return {
      ok: false,
      fields: {},
      body: normalized,
      problems: ["Frontmatter block is never closed with a `---` line."],
    };
  }
  const rawFields = normalized.slice(4, end);
  const body = normalized.slice(normalized.indexOf("\n", end + 1) + 1);
  const fields: Record<string, string | string[]> = {};

  const lines = rawFields.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      problems.push(`Unrecognized frontmatter line: ${line.trim().slice(0, 60)}`);
      continue;
    }
    const key = match[1]!;
    let value = match[2]!.trim();
    if (value === ">" || value === ">-" || value === "|" || value === "|-") {
      const folded: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) {
        i += 1;
        folded.push(lines[i]!.trim());
      }
      fields[key] = folded.join(value.startsWith("|") ? "\n" : " ").trim();
      continue;
    }
    if (!value) {
      // Possible block list.
      const list: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1]!)) {
        i += 1;
        list.push(lines[i]!.replace(/^\s+-\s+/, "").trim());
      }
      fields[key] = list.length ? list : "";
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  return { ok: problems.length === 0, fields, body, problems };
}

function requireStringField(
  fields: Record<string, string | string[]>,
  key: string,
  problems: string[],
  what: string,
): string {
  const value = fields[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  problems.push(`Frontmatter needs a non-empty \`${key}\` field (${what}).`);
  return "";
}

// ---------------------------------------------------------------------------
// rules
// ---------------------------------------------------------------------------

export type RuleScope = {
  /** Rule markdown with the optional scope frontmatter stripped. */
  body: string;
  /** Overrides the item description in Cursor .mdc frontmatter. */
  description: string | null;
  /** Path scopes → Cursor "Auto Attached" globs. Null = no scoping declared. */
  globs: string[] | null;
  /** Explicit alwaysApply override; null = derive (true unless globs given). */
  alwaysApply: boolean | null;
  problems: string[];
};

const RULE_SCOPE_KEYS = new Set(["description", "globs", "alwaysApply"]);

/**
 * A rules item is plain markdown, but it MAY start with an optional YAML
 * frontmatter block declaring Cursor scoping metadata (description / globs /
 * alwaysApply — the exact MDC fields Cursor documents for .cursor/rules/*.mdc,
 * verified 2026-08 at https://cursor.com/docs/context/rules). Claude Code
 * consumers use only the body; the Cursor writer turns the metadata into MDC
 * frontmatter. Content without a leading `---` block is all body.
 */
export function parseRuleScope(content: string): RuleScope {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized, description: null, globs: null, alwaysApply: null, problems: [] };
  }
  const parsed = parseFrontmatter(normalized);
  const problems = [...parsed.problems];
  for (const key of Object.keys(parsed.fields)) {
    if (!RULE_SCOPE_KEYS.has(key)) {
      problems.push(
        `Rules frontmatter only supports description, globs, and alwaysApply (Cursor scoping) — remove \`${key}\`.`,
      );
    }
  }
  const description =
    typeof parsed.fields.description === "string" && parsed.fields.description.trim()
      ? parsed.fields.description.trim()
      : null;
  let globs: string[] | null = null;
  const cleanGlob = (glob: string) => glob.trim().replace(/^["']|["']$/g, "");
  const rawGlobs = parsed.fields.globs;
  if (Array.isArray(rawGlobs)) {
    globs = rawGlobs.map(cleanGlob).filter(Boolean);
  } else if (typeof rawGlobs === "string" && rawGlobs.trim()) {
    // Cursor docs: "Separate multiple patterns with commas."
    globs = rawGlobs.split(",").map(cleanGlob).filter(Boolean);
  }
  if (globs && !globs.length) globs = null;
  if (rawGlobs !== undefined && !globs) {
    problems.push("`globs` must be a comma-separated pattern string or a list of patterns.");
  }
  let alwaysApply: boolean | null = null;
  const rawAlways = parsed.fields.alwaysApply;
  if (rawAlways === "true") alwaysApply = true;
  else if (rawAlways === "false") alwaysApply = false;
  else if (rawAlways !== undefined) problems.push("`alwaysApply` must be true or false.");
  return { body: parsed.body, description, globs, alwaysApply, problems };
}

export function validateRules(content: string): ValidationResult {
  const problems: string[] = [];
  const scope = parseRuleScope(content);
  problems.push(...scope.problems);
  if (!scope.body.trim()) problems.push("Rules markdown is empty — write at least one rule.");
  if (content.length > MAX_RULES_ITEM_CHARS) {
    problems.push(
      `Rules item is ${content.length} characters; keep each item under ${MAX_RULES_ITEM_CHARS} so the combined rules fit in agent context.`,
    );
  }
  if (content.includes(VANTAGE_BEGIN_MARKER) || content.includes(VANTAGE_END_MARKER)) {
    problems.push("Rules must not contain the VANTAGE sync markers — sync adds those itself.");
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// subagent (.claude/agents/<name>.md)
// ---------------------------------------------------------------------------

export type SubagentDefinition = {
  name: string;
  description: string;
  tools?: string;
  model?: string;
  body: string;
};

export function parseSubagent(content: string): {
  result: ValidationResult;
  subagent: SubagentDefinition | null;
} {
  const parsed = parseFrontmatter(content);
  const problems = [...parsed.problems];
  const name = requireStringField(parsed.fields, "name", problems, "lowercase-and-hyphens identifier");
  const description = requireStringField(
    parsed.fields,
    "description",
    problems,
    "when Claude should delegate to this subagent",
  );
  if (name && !AGENT_CONFIG_NAME.test(name)) {
    problems.push("Subagent `name` must be lowercase letters, digits, and hyphens.");
  }
  const rawTools = parsed.fields.tools;
  const tools = Array.isArray(rawTools)
    ? rawTools.join(", ")
    : typeof rawTools === "string" && rawTools.trim()
      ? rawTools.trim()
      : undefined;
  if (rawTools !== undefined && !tools) {
    problems.push("`tools` must be a comma-separated string or a list of tool names.");
  }
  const model =
    typeof parsed.fields.model === "string" && parsed.fields.model.trim()
      ? parsed.fields.model.trim()
      : undefined;
  if (parsed.fields.model !== undefined && !model) {
    problems.push("`model` must be a model alias (sonnet, opus, haiku, inherit) or a full model id.");
  }
  if (!parsed.body.trim()) {
    problems.push("The markdown body after the frontmatter is the system prompt — it cannot be empty.");
  }
  const ok = problems.length === 0;
  return {
    result: { ok, problems },
    subagent: ok ? { name, description, tools, model, body: parsed.body.trim() } : null,
  };
}

export function validateSubagent(content: string): ValidationResult {
  return parseSubagent(content).result;
}

// ---------------------------------------------------------------------------
// mcp-server (.mcp.json mcpServers entry)
// ---------------------------------------------------------------------------

export type McpServerEntry =
  | { command: string; args?: string[]; env?: Record<string, string> }
  | { url: string; type?: string; headers?: Record<string, string> };

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/, // OpenAI/Stripe-style keys (also inside "Bearer …")
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{16,}/,
  /\bxox[abprs]-/, // Slack
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{20,}/, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
];

const PLACEHOLDER_VALUE = /^(\$\{[A-Za-z0-9_]+\}|\$[A-Za-z0-9_]+|<[^>]*>|YOUR_.*|CHANGE[-_ ]?ME.*|REPLACE.*|PLACEHOLDER.*|x{4,}|\*{4,})$/i;
const SECRETY_KEY = /key|secret|token|password|passwd|credential|authorization/i;

/**
 * Team config is shared with every member — env values must never carry real
 * credentials. Placeholders like ${MY_TOKEN} are fine: each member sets the
 * real value in their own local environment.
 */
export function looksLikeSecretValue(key: string, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_VALUE.test(trimmed)) return false;
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  if (!SECRETY_KEY.test(key)) return false;
  // A secret-named key with a concrete opaque value: refuse long token-shaped strings.
  const opaque = trimmed.replace(/^(?:Bearer|Basic|token)\s+/i, "");
  if (PLACEHOLDER_VALUE.test(opaque)) return false;
  return opaque.length >= 16 && /^[A-Za-z0-9+/=_.-]+$/.test(opaque) && /[0-9]/.test(opaque);
}

function checkEnvLikeMap(
  map: Record<string, unknown>,
  label: string,
  problems: string[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== "string") {
      problems.push(`\`${label}.${key}\` must be a string.`);
      continue;
    }
    if (looksLikeSecretValue(key, value)) {
      problems.push(
        `\`${label}.${key}\` looks like a real credential. Team config is not secret storage — use a placeholder like \${${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}} and have each member set the real value in their own local environment.`,
      );
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseMcpServer(content: string): {
  result: ValidationResult;
  entry: McpServerEntry | null;
} {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { result: { ok: false, problems: ["Content must be valid JSON."] }, entry: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      result: { ok: false, problems: ["Content must be a JSON object (one mcpServers entry)."] },
      entry: null,
    };
  }
  let record = raw as Record<string, unknown>;
  // Accept a pasted { "mcpServers": { "name": {...} } } wrapper with exactly one server.
  if (record.mcpServers && typeof record.mcpServers === "object" && !Array.isArray(record.mcpServers)) {
    const servers = Object.values(record.mcpServers as Record<string, unknown>);
    if (servers.length !== 1 || !servers[0] || typeof servers[0] !== "object") {
      return {
        result: {
          ok: false,
          problems: ["Paste exactly one server entry — the object under mcpServers.<name>."],
        },
        entry: null,
      };
    }
    record = servers[0] as Record<string, unknown>;
  }

  const hasCommand = typeof record.command === "string" && record.command.trim().length > 0;
  const hasUrl = typeof record.url === "string" && record.url.trim().length > 0;
  if (hasCommand && hasUrl) problems.push("Provide either `command` (stdio) or `url` (remote), not both.");
  if (!hasCommand && !hasUrl) {
    problems.push('An MCP server entry needs `"command"` (stdio server) or `"url"` (remote server).');
  }

  let entry: McpServerEntry | null = null;
  if (hasCommand) {
    let args: string[] | undefined;
    if (record.args !== undefined) {
      if (Array.isArray(record.args) && record.args.every((item) => typeof item === "string")) {
        args = record.args as string[];
      } else {
        problems.push("`args` must be an array of strings.");
      }
    }
    let env: Record<string, string> | undefined;
    if (record.env !== undefined) {
      if (record.env && typeof record.env === "object" && !Array.isArray(record.env)) {
        env = checkEnvLikeMap(record.env as Record<string, unknown>, "env", problems);
      } else {
        problems.push("`env` must be an object of string values.");
      }
    }
    entry = { command: String(record.command).trim(), ...(args ? { args } : {}), ...(env ? { env } : {}) };
  } else if (hasUrl) {
    const url = String(record.url).trim();
    if (!/^https?:\/\//.test(url)) problems.push("`url` must be an http(s) URL.");
    let headers: Record<string, string> | undefined;
    if (record.headers !== undefined) {
      if (record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)) {
        headers = checkEnvLikeMap(record.headers as Record<string, unknown>, "headers", problems);
      } else {
        problems.push("`headers` must be an object of string values.");
      }
    }
    entry = {
      url,
      ...(typeof record.type === "string" && record.type.trim() ? { type: record.type.trim() } : {}),
      ...(headers ? { headers } : {}),
    };
  }

  const ok = problems.length === 0;
  return { result: { ok, problems }, entry: ok ? entry : null };
}

export function validateMcpServer(content: string): ValidationResult {
  return parseMcpServer(content).result;
}

// ---------------------------------------------------------------------------
// permissions (settings.json permissions.allow/deny/ask)
// ---------------------------------------------------------------------------

const PERMISSION_RULE = /^[A-Za-z][A-Za-z0-9_]*(\([^)]{0,300}\))?$/;
const MCP_PERMISSION_RULE = /^mcp__[A-Za-z0-9_-]+(__[A-Za-z0-9_*.-]+)?$/;

export type PermissionsSnippet = { allow?: string[]; deny?: string[]; ask?: string[] };

export function parsePermissions(content: string): {
  result: ValidationResult;
  permissions: PermissionsSnippet | null;
} {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { result: { ok: false, problems: ["Content must be valid JSON."] }, permissions: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      result: { ok: false, problems: ["Content must be a JSON object with allow/deny/ask arrays."] },
      permissions: null,
    };
  }
  let record = raw as Record<string, unknown>;
  if (record.permissions && typeof record.permissions === "object" && !Array.isArray(record.permissions)) {
    record = record.permissions as Record<string, unknown>;
  }

  const out: PermissionsSnippet = {};
  const lists: Array<keyof PermissionsSnippet> = ["allow", "deny", "ask"];
  for (const key of Object.keys(record)) {
    if (!lists.includes(key as keyof PermissionsSnippet)) {
      problems.push(`Unknown key \`${key}\` — only allow, deny, and ask arrays are shared here.`);
    }
  }
  let ruleCount = 0;
  for (const list of lists) {
    const value = record[list];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      problems.push(`\`${list}\` must be an array of permission rule strings.`);
      continue;
    }
    for (const rule of value as string[]) {
      ruleCount += 1;
      if (!PERMISSION_RULE.test(rule) && !MCP_PERMISSION_RULE.test(rule)) {
        problems.push(
          `Rule \`${rule.slice(0, 80)}\` does not look like \`Tool\`, \`Tool(specifier)\`, or \`mcp__server__tool\`.`,
        );
      }
    }
    out[list] = value as string[];
  }
  if (ruleCount === 0) problems.push("Add at least one rule under allow, deny, or ask.");

  const ok = problems.length === 0;
  return { result: { ok, problems }, permissions: ok ? out : null };
}

export function validatePermissions(content: string): ValidationResult {
  return parsePermissions(content).result;
}

// ---------------------------------------------------------------------------
// skill (SKILL.md-style)
// ---------------------------------------------------------------------------

export function validateSkill(content: string): ValidationResult {
  const parsed = parseFrontmatter(content);
  const problems = [...parsed.problems];
  const name = requireStringField(parsed.fields, "name", problems, "skill identifier");
  requireStringField(parsed.fields, "description", problems, "when the skill should be used");
  if (name && !AGENT_CONFIG_NAME.test(name)) {
    problems.push("Skill `name` must be lowercase letters, digits, and hyphens.");
  }
  if (!parsed.body.trim()) {
    problems.push("The markdown body after the frontmatter is the skill's instructions — it cannot be empty.");
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

export function validateAgentConfigContent(kind: AgentConfigKind, content: string): ValidationResult {
  if (content.length > MAX_CONTENT_CHARS) {
    return {
      ok: false,
      problems: [`Content is ${content.length} characters; the limit is ${MAX_CONTENT_CHARS}.`],
    };
  }
  switch (kind) {
    case "rules":
      return validateRules(content);
    case "subagent":
      return validateSubagent(content);
    case "mcp-server":
      return validateMcpServer(content);
    case "permissions":
      return validatePermissions(content);
    case "skill":
      return validateSkill(content);
  }
}
