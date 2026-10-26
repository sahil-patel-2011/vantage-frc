import type { PoolClient } from "@neondatabase/serverless";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { ScoutingHttpError } from "../scouting-auth";
import { loadBootstrapExtras, withMatchStatus } from "./bootstrap-extras";

/** The scouting screen's first payload: forms, matches, and this person's reports. */
export async function loadScoutingBootstrap(
  client: PoolClient,
  input: { orgId: string; userId: string; eventKey?: string | null },
) {
  const selected = input.eventKey
    ? await client.query<{ eventKey: string; eventName: string | null }>(
        `SELECT event_key AS "eventKey", name AS "eventName" FROM events_ref WHERE event_key = $1`,
        [input.eventKey],
      )
    : null;
  if (input.eventKey && !selected?.rows[0]) {
    throw new ScoutingHttpError(404, "This event is not available. Choose another event.");
  }
  const base = await new ScoutingRepository(client).bootstrap(input.orgId, input.userId, selected?.rows[0]);
  const extras = await loadBootstrapExtras(client, {
    orgId: input.orgId,
    userId: input.userId,
    eventKey: base.eventKey,
  });
  return {
    ...base,
    matches: withMatchStatus(base.matches as Array<{ matchKey: string }>, extras.matchStatus),
    myEntries: extras.myEntries,
    scouted: extras.scouted,
    pitScouted: extras.pitScouted,
    roster: extras.roster,
    rosterComplete: extras.rosterComplete,
    teamNumber: extras.teamNumber,
  };
}
