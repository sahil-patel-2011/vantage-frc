/**
 * Ask the catalog whether an optional table/column exists, without letting the
 * answer poison anything.
 *
 * Several features are legitimately optional against an older database — channel
 * archive, chat pins/mentions/object links, the youth-protection DM rules, the
 * hour-log auto-close flags. Each of them asked `information_schema` once and
 * cached the answer for the life of the process. Written as a bare
 * `try { … } catch { cache = false }` that has two teeth:
 *
 *  1. **A transient failure becomes a permanent feature outage.** The request runs
 *     in one `withRls` transaction. If an earlier statement had already aborted it,
 *     the probe failed with 25P02 — and the catch cached `false`, disabling that
 *     feature for the whole server process, for every org, until a restart. The
 *     youth-protection probe is the sharp one: caching `false` there quietly stops
 *     enforcing the two-adult DM rule.
 *  2. **Swallowing inside the transaction leaves it aborted** for every later
 *     statement in the same request, so one probe empties unrelated features.
 *
 * `probeSchemaSupport` fixes both: a savepoint contains the failure, and the
 * result is `null` — "could not tell" — which callers answer conservatively for
 * this request only and must never cache. Only a definitive answer is remembered.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";

/** `true`/`false` when the catalog answered; `null` when the probe itself failed. */
export async function probeSchemaSupport(
  client: PoolClient,
  sql: string,
): Promise<boolean | null> {
  return withSavepoint(
    client,
    async () => Boolean((await client.query(sql)).rowCount),
    null as boolean | null,
  );
}

/**
 * The read-through cache around `probeSchemaSupport`.
 *
 * `read`/`write` are the caller's process-lifetime slot. A `null` probe result is
 * answered `false` for this request and deliberately left uncached, so the next
 * request on a healthy transaction gets to ask again.
 */
export async function cachedSchemaSupport(
  client: PoolClient,
  cache: { read: () => boolean | null; write: (value: boolean) => void },
  sql: string,
): Promise<boolean> {
  const cached = cache.read();
  if (cached != null) return cached;
  const supported = await probeSchemaSupport(client, sql);
  if (supported == null) return false;
  cache.write(supported);
  return supported;
}
