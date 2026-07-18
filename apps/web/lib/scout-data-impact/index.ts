// Pure helper functions for Scout Data Impact — no I/O, no framework imports.
// Unit-testable in isolation from the DB/route layer.

export * from "./types";
import type { PickImpact, ScoutContribution, ScoutImpactSummary } from "./types";

/**
 * Roll a list of per-pick impact breakdowns up into a per-scout summary: how many
 * picks each scout's data informed, how many entries they contributed in total, and
 * which picked teams they personally scouted.
 */
export function summarizeByScout(pickImpacts: PickImpact[]): ScoutImpactSummary[] {
  const byScout = new Map<string, ScoutImpactSummary>();

  for (const pickImpact of pickImpacts) {
    for (const contribution of pickImpact.contributions) {
      const existing = byScout.get(contribution.scoutUserId);
      if (existing) {
        existing.picksInformed += 1;
        existing.totalEntries += contribution.entryCount;
        if (!existing.teamsScoutedThatWerePicked.includes(pickImpact.pick.teamKey)) {
          existing.teamsScoutedThatWerePicked.push(pickImpact.pick.teamKey);
        }
      } else {
        byScout.set(contribution.scoutUserId, {
          scoutUserId: contribution.scoutUserId,
          scoutName: contribution.scoutName,
          picksInformed: 1,
          totalEntries: contribution.entryCount,
          teamsScoutedThatWerePicked: [pickImpact.pick.teamKey],
        });
      }
    }
  }

  return [...byScout.values()].sort((a, b) => b.totalEntries - a.totalEntries || a.scoutName.localeCompare(b.scoutName));
}

/** Sort contributions within a single pick by entry volume, most-contributed first. */
export function rankContributions(contributions: ScoutContribution[]): ScoutContribution[] {
  return [...contributions].sort((a, b) => b.entryCount - a.entryCount || a.scoutName.localeCompare(b.scoutName));
}

/** Total scouting entries that fed into every logged pick at an event. */
export function totalEntriesInformingPicks(pickImpacts: PickImpact[]): number {
  return pickImpacts.reduce((sum, item) => sum + item.totalEntries, 0);
}

/** Share (0..1) of logged picks that have at least one attributable scouting entry. */
export function pickCoverageRatio(pickImpacts: PickImpact[]): number {
  if (pickImpacts.length === 0) return 0;
  const covered = pickImpacts.filter((item) => item.totalEntries > 0).length;
  return covered / pickImpacts.length;
}
