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
export type EventDayPackItem = {
  feature: OfflineFeature;
  api: string;
  route: string;
  label: string;
  /**
   * Light enough to refresh quietly in the background (warmEventDayInBackground). Strategy and
   * the briefing compute on request, so they are only fetched when someone saves the pack.
   */
  background?: boolean;
};

export const EVENT_DAY_PACK: readonly EventDayPackItem[] = [
  { feature: "competition", api: "/api/command", route: "/command", label: "Event Day", background: true },
  { feature: "my-day", api: "/api/my-day", route: "/my-day", label: "My Day", background: true },
  { feature: "schedule", api: "/api/schedule", route: "/schedule", label: "the schedule", background: true },
  { feature: "pit", api: "/api/pit", route: "/pit", label: "Pit" },
  { feature: "match-checklist", api: "/api/match-checklist", route: "/match-checklist", label: "the match checklist" },
  { feature: "packing", api: "/api/packing", route: "/packing", label: "the packing list" },
  { feature: "strategy", api: "/api/strategy", route: "/strategy", label: "Strategy" },
  { feature: "briefing", api: "/api/briefing", route: "/briefing", label: "the pre-match briefing" },
];

export async function saveEventDayPack(
  orgId: string,
  options: {
    fetchImpl?: typeof fetch;
    save?: (feature: OfflineFeature, orgId: string, data: unknown) => Promise<void>;
    onProgress?: (done: number, total: number) => void;
    /** Only these items (the background warm passes the light ones). */
    items?: readonly EventDayPackItem[];
  } = {},
): Promise<{ saved: string[]; failed: string[] }> {
  const doFetch = options.fetchImpl ?? fetch;
  const save = options.save ?? ((feature, org, data) => putFeatureSnapshot(feature, org, data));
  const items = options.items ?? EVENT_DAY_PACK;
  const saved: string[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const item of items) {
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
    options.onProgress?.(done, items.length);
  }
  return { saved, failed };
}

/** How often the quiet background refresh may run per team on this device. */
export const BACKGROUND_WARM_MS = 30 * 60 * 1000;

/**
 * Keep Event Day, My Day and the schedule ready on this device without anyone pressing Save:
 * once every 30 minutes per team, only online, never on a data-saver connection, and only the
 * light pages. Each page already opens from its saved copy and refreshes after, so this makes the
 * first open of the day instant instead of waiting on the network in a crowded venue.
 */
export async function warmEventDayInBackground(
  orgId: string,
  env: {
    now?: () => number;
    storage?: Pick<Storage, "getItem" | "setItem"> | null;
    online?: boolean;
    saveData?: boolean;
    fetchImpl?: typeof fetch;
    save?: (feature: OfflineFeature, orgId: string, data: unknown) => Promise<void>;
  } = {},
): Promise<{ ran: boolean; saved: string[] }> {
  if (!orgId) return { ran: false, saved: [] };
  const online = env.online ?? (typeof navigator === "undefined" ? false : navigator.onLine);
  const saveData =
    env.saveData ??
    (typeof navigator !== "undefined" && Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData));
  if (!online || saveData) return { ran: false, saved: [] };
  const now = (env.now ?? Date.now)();
  const key = `vantage-event-day-warm:${orgId}`;
  try {
    const storage: Pick<Storage, "getItem" | "setItem"> | null = env.storage !== undefined ? env.storage : typeof window === "undefined" ? null : window.localStorage;
    const stored = storage?.getItem(key) ?? null;
    const last = stored == null ? null : Number(stored);
    if (last != null && Number.isFinite(last) && now - last < BACKGROUND_WARM_MS) return { ran: false, saved: [] };
    storage?.setItem(key, String(now));
  } catch {
    // No storage: still warm, just without the throttle memory.
  }
  const result = await saveEventDayPack(orgId, {
    fetchImpl: env.fetchImpl,
    save: env.save,
    items: EVENT_DAY_PACK.filter((item) => item.background),
  });
  return { ran: true, saved: result.saved };
}
