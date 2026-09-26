import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";

type JoinedRow = { userId: string; email: string | null; name: string | null };

/**
 * "Someone you invited joined as Student" was written when the person accepted, before they had
 * typed their name in onboarding. When the owner reads it, say who: their name if they have
 * given one, else the email they were invited at. Read under the owner's own row security (an
 * owner or admin can read their team's invites), in a savepoint so a failure changes nothing.
 */
export async function joinerNames(client: PoolClient, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const rows = await withSavepoint(
    client,
    async () =>
      (
        await client.query<JoinedRow>(
          `SELECT i.accepted_by::text AS "userId", i.email,
                  COALESCE(NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''), NULLIF(p.display_name, '')) AS name
             FROM invites i
             LEFT JOIN profiles p ON p.user_id = i.accepted_by
            WHERE i.accepted_by = ANY($1::uuid[])
            ORDER BY i.accepted_at DESC NULLS LAST`,
          [userIds],
        )
      ).rows,
    [] as JoinedRow[],
  );
  for (const row of rows) {
    if (out.has(row.userId)) continue;
    const name = row.name?.trim();
    const email = row.email?.trim();
    const who = name && email ? `${name} (${email})` : name || email;
    if (who) out.set(row.userId, who);
  }
  return out;
}

/** "Someone you invited joined as Student" → "Sam Lee (sam@school.org) joined as Student". */
export function nameTheJoiner(title: string, who: string | undefined): string {
  if (!who) return title;
  return title.replace(/^Someone you invited\b/, who);
}
