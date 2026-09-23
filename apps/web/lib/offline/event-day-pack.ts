import { putFeatureSnapshot, type OfflineFeature } from "./feature-cache";

/**
 * "Save event day on this phone" (Vantage's This phone page).
 *
 * Each event-day page keeps its own offline copy — the raw GET response of its API under
 * its own feature key — but only after someone opens it online. This fetches the same
 * responses up front and stores them under the same keys each page reads, so Event Day,
 * My Day, the schedule, Pit, the match checklist and the packing list open in a pit with
 * no signal. The pages themselves are stored by the service worker (warmOfflineRoutes).
 *
 * The keys and URLs mirror the pages (command-client, my-day-client, schedule-client,
 * pit-command-client, match-checklist-client, packing-client); a response carrying an
 * `error` is not saved, so a failure never replaces a good copy with a bad one.
 */
export type EventDayPackItem = { feature: OfflineFeature; api: string; route: string; label: string };

export const EVENT_DAY_PACK: readonly EventDayPackItem[] = [
  { feature: "competition", api: "/api/command", route: "/command", label: "Event Day" },
  { feature: "my-day", api: "/api/my-day", route: "/my-day", label: "My Day" },
  { feature: "schedule", api: "/api/schedule", route: "/schedule", label: "the schedule" },
  { feature: "pit", api: "/api/pit", route: "/pit", label: "Pit" },
  { feature: "match-checklist", api: "/api/match-checklist", route: "/match-checklist", label: "the match checklist" },
  { feature: "packing", api: "/api/packing", route: "/packing", label: "the packing list" },
];

export async function saveEventDayPack(
  orgId: string,
  options: {
    fetchImpl?: typeof fetch;
    save?: (feature: OfflineFeature, orgId: string, data: unknown) => Promise<void>;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ saved: string[]; failed: string[] }> {
  const doFetch = options.fetchImpl ?? fetch;
  const save = options.save ?? ((feature, org, data) => putFeatureSnapshot(feature, org, data));
  const saved: string[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const item of EVENT_DAY_PACK) {
    try {
      const response = await doFetch(`${item.api}?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const data = response.ok ? ((await response.json()) as unknown) : null;
      if (data && typeof data === "object" && !("error" in (data as Record<string, unknown>))) {
        await save(item.feature, orgId, data);
        saved.push(item.label);
      } else {
        failed.push(item.label);
      }
    } catch {
      failed.push(item.label);
    }
    done += 1;
    options.onProgress?.(done, EVENT_DAY_PACK.length);
  }
  return { saved, failed };
}
