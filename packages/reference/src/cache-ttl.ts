/** Freshness windows for the shared Neon TBA/Statbotics cache. Never a second store. */

export const DEFAULT_STATBOTICS_EVENT_TTL_MS = 15 * 60 * 1_000;
export const DEFAULT_STATBOTICS_YEAR_TTL_MS = 6 * 60 * 60 * 1_000;
/** Product pages skip a new ingest when match rows are newer than this. */
export const DEFAULT_TBA_MATCH_FRESH_MS = 2 * 60 * 1_000;

export function readPositiveMs(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function isSyncedWithin(
  syncedAt: Date | string | null | undefined,
  ttlMs: number,
  now: Date = new Date(),
): boolean {
  if (!syncedAt) return false;
  const stamp = syncedAt instanceof Date ? syncedAt.getTime() : Date.parse(String(syncedAt));
  if (!Number.isFinite(stamp)) return false;
  return now.getTime() - stamp < ttlMs;
}

export function statboticsTtlMs(
  resource: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (resource.startsWith("team_years")) {
    return readPositiveMs("STATBOTICS_YEAR_TTL_MS", DEFAULT_STATBOTICS_YEAR_TTL_MS, env);
  }
  return readPositiveMs("STATBOTICS_EVENT_TTL_MS", DEFAULT_STATBOTICS_EVENT_TTL_MS, env);
}

export function eventReferenceIsFresh(input: {
  matchCount: number;
  matchSyncedAt: string | null;
  epaCount: number;
  epaSyncedAt: string | null;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const matchTtl = readPositiveMs("REFERENCE_MATCH_FRESH_MS", DEFAULT_TBA_MATCH_FRESH_MS, env);
  const epaTtl = readPositiveMs("STATBOTICS_EVENT_TTL_MS", DEFAULT_STATBOTICS_EVENT_TTL_MS, env);
  if (input.matchCount <= 0 || input.epaCount <= 0) return false;
  if (!isSyncedWithin(input.matchSyncedAt, matchTtl, now)) return false;
  if (!isSyncedWithin(input.epaSyncedAt, epaTtl, now)) return false;
  return true;
}

const EVENT_KEY = /^\d{4}[a-z0-9]+$/i;

export function isTbaEventKey(value: string | null | undefined): boolean {
  return Boolean(value && EVENT_KEY.test(value.trim()));
}
