import type { PoolClient } from "@neondatabase/serverless";
import { platformTbaEnvConfigured } from "@vantage/reference";

/** Shared TBA readiness signal for account/me/strategy surfaces. */
export async function resolveTbaConfigured(
  client: PoolClient,
  orgId: string | null = null,
): Promise<{
  tbaConfigured: boolean;
  platformEnvKey: boolean;
  credentialAvailable: boolean;
  cacheHasSync: boolean;
}> {
  const platformEnvKey = platformTbaEnvConfigured();
  let credentialAvailable = false;
  try {
    const credentials = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM data_source_credentials
         WHERE source = 'tba'
           AND disabled_at IS NULL
           AND (org_id IS NULL OR org_id IS NOT DISTINCT FROM $1::uuid)
       ) AS ok`,
      [orgId],
    );
    credentialAvailable = Boolean(credentials.rows[0]?.ok);
  } catch {
    credentialAvailable = false;
  }

  const cache = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
            OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1)
            OR EXISTS(SELECT 1 FROM events_ref LIMIT 1) AS ok`,
  );
  const cacheHasSync = Boolean(cache.rows[0]?.ok);
  return {
    platformEnvKey,
    credentialAvailable,
    cacheHasSync,
    tbaConfigured: platformEnvKey || credentialAvailable || cacheHasSync,
  };
}
