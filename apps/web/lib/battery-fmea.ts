import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { RESISTANCE_RETIRE_MOHM } from "./battery";

/**
 * When a pack crosses the retire IR threshold, open both:
 * - pit robot_failures (release-gate / Event Day)
 * - structured fmea_failures (CD #41 FMEA log)
 * Idempotent per open pack label so repeated Beak tests don't spam.
 */
export async function ensureBatteryRetireFailure(
  client: PoolClient,
  input: { orgId: string; userId: string; label: string; resistanceMohm: number; seasonYear?: number },
) {
  if (input.resistanceMohm < RESISTANCE_RETIRE_MOHM) return;

  const symptoms = `Pack ${input.label} internal resistance ${input.resistanceMohm} mOhm at/past retire threshold — quarantine or replace before match use.`;
  const seasonYear = input.seasonYear ?? new Date().getUTCFullYear();

  const openPit = await client.query(
    `SELECT 1 FROM robot_failures
     WHERE org_id = $1 AND resolved_at IS NULL
       AND lower(subsystem) = 'battery'
       AND symptoms ILIKE $2
     LIMIT 1`,
    [input.orgId, `%${input.label}%`],
  );
  if (!openPit.rowCount) {
    await client.query(
      `INSERT INTO robot_failures(org_id,event_key,match_key,subsystem,severity,symptoms,occurred_at,recorded_by)
       VALUES (
         $1,
         (SELECT active_event_key FROM org_active_context WHERE org_id = $1),
         NULL,
         'Battery',
         'degraded',
         $2,
         now(),
         $3
       )`,
      [input.orgId, symptoms, input.userId],
    );
  }

  // The FMEA log is the optional half of this pair: the pit row above is what the
  // release gate reads, and it must survive an `fmea_failures` that this deploy has
  // not migrated yet. A bare catch here did the opposite — the failed statement
  // aborted the shared withRls transaction, so the pit row the comment promised
  // "still lands" was rolled back at COMMIT along with the Beak test that caused it.
  await withSavepoint(client, async () => {
    const openFmea = await client.query(
      `SELECT 1 FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2
         AND status IN ('open', 'fixing')
         AND lower(subsystem_name) = 'battery'
         AND title ILIKE $3
       LIMIT 1`,
      [input.orgId, seasonYear, `%${input.label}%`],
    );
    if (!openFmea.rowCount) {
      await client.query(
        `INSERT INTO fmea_failures (
           org_id, season_year, robot_label, subsystem_name, title, failure_mode, context,
           occurrence, severity, detection, root_cause, fix, status, event_key, recorded_by
         ) VALUES (
           $1, $2, 'competition', 'Battery', $3, $4, 'pit',
           6, 7, 3, $5, $6, 'open',
           (SELECT active_event_key FROM org_active_context WHERE org_id = $1),
           $7
         )`,
        [
          input.orgId,
          seasonYear,
          `Battery pack ${input.label} past retire IR`,
          "Elevated internal resistance / capacity fade causing brownout or mid-match voltage sag",
          `Measured ${input.resistanceMohm} mOhm (retire threshold ${RESISTANCE_RETIRE_MOHM} mOhm).`,
          "Quarantine pack, pull a ready spare, re-test with Battery Beak before returning to rotation.",
          input.userId,
        ],
      );
    }
  }, undefined);
}
