/** Device-wide preference. Never applies to drafts or pending writes. */
export const OFFLINE_BUDGET_KEY = "vantage:offline-budget-gb:v1";
export const GB = 1024 ** 3;
export function parseOfflineBudget(value: unknown): number {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 2 && number <= 20 ? number : 2;
}
export function readOfflineBudget(): number {
  try { return parseOfflineBudget(localStorage.getItem(OFFLINE_BUDGET_KEY)); }
  catch { return 2; }
}
export function saveOfflineBudget(value: number): void {
  if (parseOfflineBudget(value) !== value) throw new Error("Choose a whole number from 2 to 20 GB.");
  localStorage.setItem(OFFLINE_BUDGET_KEY, String(value));
}
export function cacheAllowance(budgetGB: number, quota?: number): number {
  const requested = parseOfflineBudget(budgetGB) * GB;
  // Leave headroom for unsent work and browser bookkeeping.
  return Number.isFinite(quota) && quota! >= 0 ? Math.min(requested, quota! * 0.9) : requested;
}
export async function availableCacheBytes(): Promise<number> {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const usage = typeof estimate?.usage === "number" && Number.isFinite(estimate.usage) ? Math.max(0, estimate.usage) : 0;
  return Math.max(0, cacheAllowance(readOfflineBudget(), estimate?.quota) - usage);
}
/** Best-effort quota estimate; IndexedDB remains the authority when storage is unavailable. */
export async function checkCacheSpace(bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Invalid cache size.");
  if (typeof navigator === "undefined") return;
  if (bytes > await availableCacheBytes()) {
    throw new Error("Offline cache limit reached. Increase it in Account → Appearance → Offline storage, or remove saved downloads. Unsent work is kept.");
  }
}
export function cacheJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
