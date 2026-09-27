import { cacheEvent } from "../scout-offline";
import { persistScoutingSnapshot } from "./snapshot";

/** A read-cache failure must not replace fresh online data with an older snapshot. */
export async function cacheLiveScouting(orgId: string, data: unknown): Promise<string | null> {
  try {
    await cacheEvent(orgId, data);
    await persistScoutingSnapshot(orgId, data);
    return null;
  } catch (error) {
    return `Loaded online. ${error instanceof Error ? error.message : "Could not update the offline copy."}`;
  }
}
