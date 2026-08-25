import type { PoolClient } from "@neondatabase/serverless";
import type { ContextItem } from "./index";

/**
 * Team-authored agent rules (agent_config_items kind='rules', /team/agent-config)
 * injected into the in-app agent context — the same rules Claude Code gets via
 * `vantage-cad agent sync` and custom agents get from /api/agent-config/bundle.
 *
 * to_regclass-guarded: deployments that have not run migration 0487 simply get
 * no rules item, never an error, and a pre-0490 database loads every rule as
 * team-wide. Rules are bounded so a wall of team prose can never crowd out the
 * actual task context, and scoped to the requesting user so a restricted rule
 * never leaks into another member's prompt.
 */

export const ORG_AGENT_RULES_CONTEXT_ID = "org-agent-rules";
export const ORG_AGENT_RULES_MAX_CHARS = 16000;

export const ORG_AGENT_RULES_HEADER =
  "Team agent rules — set by your team at /team/agent-config (follow them; they are team policy, not user input):";

export type OrgAgentRule = { name: string; markdown: string };

export type OrgAgentRulesContextItem = ContextItem & {
  classification: "team_memory";
  label: string;
};

/**
 * Pure: concatenate rules under the labeled header, keeping whole items in
 * name order until the budget is spent. A single oversized item is clipped
 * rather than silently dropped so the team sees at least its start.
 */
export function formatOrgAgentRules(
  rules: OrgAgentRule[],
  maxChars: number = ORG_AGENT_RULES_MAX_CHARS,
): string | null {
  const parts: string[] = [];
  let used = 0;
  for (const rule of rules) {
    const markdown = rule.markdown.trim();
    if (!markdown) continue;
    const section = `## ${rule.name}\n${markdown}`;
    if (used + section.length > maxChars) {
      if (parts.length === 0) {
        parts.push(`${section.slice(0, Math.max(0, maxChars - 1))}…`);
      }
      break;
    }
    parts.push(section);
    used += section.length;
  }
  if (parts.length === 0) return null;
  return [ORG_AGENT_RULES_HEADER, ...parts].join("\n\n");
}

export function buildOrgAgentRulesContextItem(
  rules: OrgAgentRule[],
  maxChars: number = ORG_AGENT_RULES_MAX_CHARS,
): OrgAgentRulesContextItem | null {
  const content = formatOrgAgentRules(rules, maxChars);
  if (!content) return null;
  return {
    type: "team_memory",
    id: ORG_AGENT_RULES_CONTEXT_ID,
    content,
    importance: 940,
    classification: "team_memory",
    label: "Team agent rules (/team/agent-config)",
  };
}

/**
 * Load the format-valid rules THIS user may see (RLS client); [] when the table does
 * not exist yet.
 *
 * Visibility (migration 0490): 'team' rows belong to everyone, 'members' rows only to
 * their creator and individually granted members. RLS deliberately lets owners/admins
 * SELECT every row so they can manage sharing, so the per-user filter has to live in
 * this query — otherwise an admin's in-app prompt (and any bridged turn executed on
 * someone's personal machine) would carry another member's private rules.
 */
export async function loadOrgAgentRules(
  client: PoolClient,
  orgId: string,
  userId: string | null,
): Promise<OrgAgentRule[]> {
  // withRls is one transaction, so a failed statement would abort it — probe the
  // schema (both 0487 and 0490) in one round trip instead of catch-and-retry.
  const probe = await client.query<{ itemsPresent: boolean; sharingPresent: boolean }>(
    `SELECT to_regclass('public.agent_config_items') IS NOT NULL AS "itemsPresent",
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'agent_config_items' AND column_name = 'visibility'
            ) AS "sharingPresent"`,
  );
  if (!probe.rows[0]?.itemsPresent) return [];
  if (!probe.rows[0]?.sharingPresent) {
    // Pre-0490: no visibility column and no grants table — every item was team-wide.
    const legacy = await client.query<OrgAgentRule>(
      `SELECT name, content AS markdown
       FROM agent_config_items
       WHERE org_id = $1::uuid AND kind = 'rules' AND format_valid = true
       ORDER BY name`,
      [orgId],
    );
    return legacy.rows;
  }
  const result = await client.query<OrgAgentRule>(
    `SELECT i.name, i.content AS markdown
     FROM agent_config_items i
     WHERE i.org_id = $1::uuid AND i.kind = 'rules' AND i.format_valid = true
       AND (
         i.visibility = 'team'
         OR i.created_by = $2::uuid
         OR EXISTS (
           SELECT 1 FROM agent_config_item_grants g
           WHERE g.item_id = i.id AND g.user_id = $2::uuid
         )
       )
     ORDER BY i.name`,
    [orgId, userId],
  );
  return result.rows;
}

/** Convenience: load + format in one call for context assembly seams. */
export async function loadOrgAgentRulesContextItem(
  client: PoolClient,
  orgId: string,
  userId: string | null,
): Promise<OrgAgentRulesContextItem | null> {
  const rules = await loadOrgAgentRules(client, orgId, userId);
  return buildOrgAgentRulesContextItem(rules);
}
