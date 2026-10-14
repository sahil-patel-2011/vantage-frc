import { cacheEvent } from "../scout-offline";
import { persistScoutingSnapshot } from "./snapshot";
import { saveRoster, type OfflineRosterTeam } from "../intel/offline-teams";

/** A read-cache failure must not replace fresh online data with an older snapshot. */
export async function cacheLiveScouting(orgId: string, data: unknown): Promise<string | null> {
  try {
    await cacheEvent(orgId, data);
    await persistScoutingSnapshot(orgId, data);
    const snapshot = data as { eventKey?: unknown; roster?: unknown; rosterComplete?: boolean } | null;
    if (snapshot && typeof snapshot.eventKey === "string" && snapshot.rosterComplete === true && Array.isArray(snapshot.roster)
      && snapshot.roster.every(team => team && typeof team.teamKey === "string" && Number.isInteger(team.teamNumber))) {
      void saveRoster(orgId, snapshot.roster as OfflineRosterTeam[], snapshot.eventKey);
    }
    return null;
  } catch (error) {
    return `Loaded online. ${error instanceof Error ? error.message : "Could not update the offline copy."}`;
  }
}
