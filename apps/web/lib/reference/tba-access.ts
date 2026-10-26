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
  // Start both reads together so they share the request's round trip. The
  // credential table is optional; a missing one leaves that flag false.
  const credentialPromise = client
    .query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM data_source_credentials
         WHERE source = 'tba'
           AND disabled_at IS NULL
           AND (org_id IS NULL OR org_id IS NOT DISTINCT FROM $1::uuid)
       ) AS ok`,
      [orgId],
    )
    .then((credentials) => Boolean(credentials.rows[0]?.ok))
    .catch(() => false);
  const cachePromise = client.query<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
            OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1)
            OR EXISTS(SELECT 1 FROM events_ref LIMIT 1) AS ok`,
  );
  const [credentialAvailable, cache] = await Promise.all([credentialPromise, cachePromise]);
  const cacheHasSync = Boolean(cache.rows[0]?.ok);
  return {
    platformEnvKey,
    credentialAvailable,
    cacheHasSync,
    tbaConfigured: platformEnvKey || credentialAvailable || cacheHasSync,
  };
}
