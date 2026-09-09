/**
 * The one cockpit-prefs function that touches the database.
 *
 * It lives apart from `prefs.ts` because that module is imported by client
 * components (the account appearance panel), and anything reachable from a
 * client component must not pull `@vantage/db` — and with it `pg` — into the
 * browser bundle. Turbopack catches that as "Can't resolve 'net' / 'tls' / 'dns'"
 * rather than shipping it, but only at build time, so the split is the guard.
 */
import { withSavepoint } from "@vantage/db";
import { DEFAULT_COCKPIT_PREFS, parseCockpitPrefs, type CockpitPrefs, type CockpitQueryClient } from "./prefs";

export async function loadCockpitPrefs(
  client: CockpitQueryClient,
  userId: string,
): Promise<CockpitPrefs> {
  // `profiles.cockpit_prefs` may predate its migration, so defaults are the right
  // answer — but only under a savepoint. /api/code calls this partway through a
  // request; a plain catch left the transaction aborted and the coding-assistant
  // work that followed failed on a dead transaction.
  return withSavepoint(
    client,
    async () => {
      const result = (await client.query(
        `SELECT cockpit_prefs AS "cockpitPrefs" FROM profiles WHERE user_id = $1::uuid`,
        [userId],
      )) as { rows: Array<{ cockpitPrefs?: unknown }> };
      return parseCockpitPrefs(result.rows[0]?.cockpitPrefs);
    },
    { ...DEFAULT_COCKPIT_PREFS },
  );
}
