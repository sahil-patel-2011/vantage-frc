/**
 * How much scouting this device can hold, and whether the browser promises to
 * keep it.
 *
 * Scouting saves to IndexedDB. Browsers treat that as "best effort" storage by
 * default and may evict it under pressure — the worst possible time being the
 * afternoon of an event on a phone full of photos. `navigator.storage.persist()`
 * asks the browser to keep it; granted, it is only cleared by the person.
 * Chromium grants it to installed or engaged sites, Firefox asks the user, and
 * Safari may not implement the call — so this reports what is true and never
 * claims protection it did not get.
 */

export type DeviceStorage = {
  usage: number | null;
  quota: number | null;
  available: number | null;
  persisted: boolean | null;
  persistSupported: boolean;
};

export async function deviceStorageSummary(): Promise<DeviceStorage> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    const estimate = await storage?.estimate?.();
    usage = typeof estimate?.usage === "number" ? estimate.usage : null;
    quota = typeof estimate?.quota === "number" ? estimate.quota : null;
  } catch {
    // Some private windows reject estimate(); the card shows "—".
  }
  let persisted: boolean | null = null;
  try {
    persisted = typeof storage?.persisted === "function" ? await storage.persisted() : null;
  } catch {
    persisted = null;
  }
  return {
    usage,
    quota,
    available: usage != null && quota != null ? Math.max(0, quota - usage) : null,
    persisted,
    persistSupported: typeof storage?.persist === "function",
  };
}

/** "0 B", "812 KB", "4.2 GB" — binary units, one decimal from MB up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 2 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
