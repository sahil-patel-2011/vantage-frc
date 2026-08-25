import { sql } from "drizzle-orm";
import { dbAdmin } from "@vantage/db/admin";
import { NexusClient, hasNexusMapGeometry, parseNexusLive } from "./nexus-client";

export type NexusSyncSummary = {
  attempted: number;
  written: number;
  skipped: number;
  error: string | null;
};

function nexusKey(): string | null {
  const key = process.env.NEXUS_API_KEY?.trim() || process.env.NEXUS_AUTH_KEY?.trim();
  return key || null;
}

export async function upsertNexusSnapshot(
  eventKey: string,
  pits: Record<string, string>,
  live: unknown,
  map?: unknown,
): Promise<void> {
  const pitsJson = JSON.stringify(pits ?? {});
  const liveJson = JSON.stringify(live ?? null);
  // A map we could not fetch this cycle must not erase geometry already cached.
  const mapJson = map === undefined || map === null ? null : JSON.stringify(map);
  await dbAdmin.execute(sql`
    INSERT INTO nexus_event_snapshots (event_key, pits, live, map, synced_at)
    VALUES (
      ${eventKey}, CAST(${pitsJson} AS jsonb), CAST(${liveJson} AS jsonb),
      CAST(${mapJson} AS jsonb), now()
    )
    ON CONFLICT (event_key) DO UPDATE
    SET pits = excluded.pits,
        live = excluded.live,
        map = COALESCE(excluded.map, nexus_event_snapshots.map),
        synced_at = now()
  `);
}

/** Worker-only. Missing API key is skipped (setup_required), not a TBA failure. */
export async function syncNexusEvents(eventKeys: string[]): Promise<NexusSyncSummary> {
  const unique = [...new Set(eventKeys.map((key) => key.trim()).filter(Boolean))];
  const apiKey = nexusKey();
  if (!apiKey) {
    return { attempted: 0, written: 0, skipped: unique.length, error: null };
  }
  const client = new NexusClient({ apiKey });
  let written = 0;
  for (const eventKey of unique) {
    try {
      const [live, pits] = await Promise.all([client.getLive(eventKey), client.getPits(eventKey)]);
      parseNexusLive(live, eventKey, new Date().toISOString());
      // Venue geometry is static for the weekend and optional on many events —
      // a failure here must not fail the queue sync, and never clears the cache.
      const map = await client
        .getMap(eventKey)
        .then((geometry) => (hasNexusMapGeometry(geometry) ? geometry : null))
        .catch(() => null);
      await upsertNexusSnapshot(eventKey, pits, live, map);
      written += 1;
    } catch (error) {
      return {
        attempted: unique.length,
        written,
        skipped: unique.length - written,
        error: error instanceof Error ? error.message : "Nexus sync failed",
      };
    }
  }
  return { attempted: unique.length, written, skipped: unique.length - written, error: null };
}
