/**
 * One definition of a key's monthly room and of "team usage", shared by billing, the chat
 * resolver and the usage pages so they cannot drift apart.
 *
 * Every metered call records the key that served it in `ai_usage_events.metadata.servedKey`
 * ({ id, label, scope }: scope "member" is a personal key, "org" a team key, "platform" the
 * operator's pool). A personal key is the member's own money: its usage never counts toward the
 * team's totals, caps or budgets, and each key — personal or team — may carry its own limit for
 * the calendar month (`monthly_spend_limit_usd`, 0736; NULL = unlimited).
 */

/**
 * SQL predicate over a key row aliased `k` (member_llm_keys or org_llm_keys): the key still has
 * room this calendar month — no limit, or this month's spend on it is under the limit. Read
 * through to_jsonb so a database without the column treats every key as unlimited.
 */
export const KEY_UNDER_LIMIT_SQL = `(
  (to_jsonb(k) ->> 'monthly_spend_limit_usd') IS NULL
  OR COALESCE((
    SELECT sum(e.cost_usd) FROM ai_usage_events e
     WHERE e.org_id = k.org_id
       AND e.metadata #>> '{servedKey,id}' = k.id::text
       AND e.created_at >= date_trunc('month', now())
  ), 0) < (to_jsonb(k) ->> 'monthly_spend_limit_usd')::numeric
)`;

/**
 * SQL predicate over ai_usage_events (unaliased, or pass the alias): the row is the TEAM's usage,
 * i.e. not served by a member's personal key. Every team total, cap, allowance and budget uses it.
 */
export function teamUsageSql(alias?: string): string {
  const column = alias ? `${alias}.metadata` : "metadata";
  return `COALESCE(${column} #>> '{servedKey,scope}', '') <> 'member'`;
}

export const TEAM_USAGE_SQL = teamUsageSql();
