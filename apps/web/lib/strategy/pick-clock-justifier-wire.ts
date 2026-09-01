// Pick Clock GET/recommend overlay: stored justifier reasons after recommendNextPick.
//
// The clock still ranks from pick-desk + list hints. This wire only loads persisted
// pick_list_entries justifications and merges them onto the recommendation / alternates.
// Teams with no stored row are omitted — never invent a "why".

import type { PoolClient } from "@neondatabase/serverless";
import {
  applyStoredJustificationsToPickClockResult,
  loadStoredJustificationsForPickClock,
} from "../picklist-justifier";
import type { PickClockResult } from "./pick-clock";

export type PickClockJustifierWireInput = {
  orgId: string;
  eventKey?: string | null;
  pickListId?: string | null;
};

/** Team keys on the current clock result — the only rows the loader should fetch. */
export function pickClockJustifierTeamKeys(clock: {
  recommendation: { teamKey: string } | null;
  alternates: readonly { teamKey: string }[];
}): string[] {
  const keys = [
    clock.recommendation?.teamKey,
    ...clock.alternates.map((alt) => alt.teamKey),
  ].filter((key): key is string => Boolean(key));
  return [...new Set(keys)];
}

/**
 * After recommendNextPick: load stored justifier rows for the clock's teams and
 * overlay glanceable reasons. Empty stored index leaves the clock unchanged.
 */
export async function wirePickClockJustifications(
  client: PoolClient,
  clock: PickClockResult,
  input: PickClockJustifierWireInput,
): Promise<PickClockResult> {
  const teamKeys = pickClockJustifierTeamKeys(clock);
  if (teamKeys.length === 0) return clock;

  const stored = await loadStoredJustificationsForPickClock(client, {
    orgId: input.orgId,
    eventKey: input.eventKey,
    pickListId: input.pickListId,
    teamKeys,
  });

  return applyStoredJustificationsToPickClockResult(clock, stored.byTeamKey);
}
