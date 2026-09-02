/**
 * Per-org pit media quota (pure — no DB, no sharp). The route reads the
 * scout_media_quota row (or none) and the live usage, then asks these helpers
 * whether one more upload fits.
 */

export const DEFAULT_SCOUT_MEDIA_MAX_ITEMS = 2000;
export const DEFAULT_SCOUT_MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

export type ScoutMediaQuota = { maxItems: number; maxBytes: number };
export type ScoutMediaUsage = { items: number; bytes: number };

function toCount(value: unknown, fallback: number): number {
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

/** Missing row → defaults; bigint columns arrive as strings from pg. */
export function resolveScoutMediaQuota(
  row: { maxItems?: number | string | null; maxBytes?: number | string | null } | null | undefined,
): ScoutMediaQuota {
  return {
    maxItems: toCount(row?.maxItems, DEFAULT_SCOUT_MEDIA_MAX_ITEMS),
    maxBytes: toCount(row?.maxBytes, DEFAULT_SCOUT_MEDIA_MAX_BYTES),
  };
}

export function normalizeScoutMediaUsage(
  row: { items?: number | string | null; bytes?: number | string | null } | null | undefined,
): ScoutMediaUsage {
  return { items: toCount(row?.items, 0), bytes: toCount(row?.bytes, 0) };
}

export function formatQuotaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

/**
 * Null when `incomingBytes` more fits; otherwise a message a scout can act on.
 * Items are counted before the new one is added, so `items >= maxItems` blocks.
 */
export function scoutMediaQuotaExceededReason(
  usage: ScoutMediaUsage,
  quota: ScoutMediaQuota,
  incomingBytes: number,
): string | null {
  const incoming = Number.isFinite(incomingBytes) && incomingBytes > 0 ? incomingBytes : 0;
  if (usage.items >= quota.maxItems) {
    return `This team's pit media is at its ${quota.maxItems.toLocaleString()}-photo limit. Delete old photos in Pit photos, then retry.`;
  }
  if (usage.bytes + incoming > quota.maxBytes) {
    return `This team's pit media is at its ${formatQuotaBytes(quota.maxBytes)} storage limit (${formatQuotaBytes(usage.bytes)} used). Delete old photos in Pit photos, then retry.`;
  }
  return null;
}

/** Share-of-quota summary for the gallery header. */
export function scoutMediaQuotaSummary(usage: ScoutMediaUsage, quota: ScoutMediaQuota) {
  const itemShare = quota.maxItems > 0 ? Math.min(1, usage.items / quota.maxItems) : 1;
  const byteShare = quota.maxBytes > 0 ? Math.min(1, usage.bytes / quota.maxBytes) : 1;
  return {
    items: usage.items,
    bytes: usage.bytes,
    maxItems: quota.maxItems,
    maxBytes: quota.maxBytes,
    share: Math.max(itemShare, byteShare),
    label: `${usage.items.toLocaleString()} / ${quota.maxItems.toLocaleString()} photos · ${formatQuotaBytes(usage.bytes)} of ${formatQuotaBytes(quota.maxBytes)}`,
  };
}
