import { openValue, outageSecret, readJson, sealValue, writeJson, type OutageStore } from "./status-store";

/**
 * Who gets the "Vantage is limited" email when the database — and so the users table — is
 * out of reach: a snapshot taken while it was healthy (list_service_notice_recipients(),
 * migration 0718), sealed before it is stored, refreshed when a platform admin is signed in
 * and it is older than 12 hours.
 */

export const RECIPIENTS_KEY = "recipients";
/** Associated data for the seal: a value sealed for anything else can't be opened as this. */
export const RECIPIENTS_LABEL = "service-notice-recipients";
export const SNAPSHOT_STALE_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_TTL_SECONDS = 45 * 24 * 60 * 60;
const MAX_RECIPIENTS = 5_000;

type StoredSnapshot = { v: 1; refreshedAt: string; count: number; sealed: string };
export type RecipientMeta = { count: number; refreshedAt: string };

/** Lowercased, trimmed, plausible addresses only, each once, in a stable order. */
export function normalizeRecipients(values: readonly unknown[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    unique.add(email);
  }
  return [...unique].sort().slice(0, MAX_RECIPIENTS);
}

export async function saveRecipientSnapshot(
  store: OutageStore,
  emails: readonly unknown[],
  now = Date.now(),
  secret = outageSecret(),
): Promise<RecipientMeta> {
  const list = normalizeRecipients(emails);
  const snapshot: StoredSnapshot = {
    v: 1,
    refreshedAt: new Date(now).toISOString(),
    count: list.length,
    sealed: sealValue(JSON.stringify(list), RECIPIENTS_LABEL, secret),
  };
  await writeJson(store, RECIPIENTS_KEY, snapshot, { ttlSeconds: SNAPSHOT_TTL_SECONDS });
  return { count: snapshot.count, refreshedAt: snapshot.refreshedAt };
}

export async function readRecipientMeta(store: OutageStore): Promise<RecipientMeta | null> {
  const snapshot = await readJson<StoredSnapshot>(store, RECIPIENTS_KEY);
  if (!snapshot || snapshot.v !== 1 || typeof snapshot.refreshedAt !== "string") return null;
  return { count: Number(snapshot.count) || 0, refreshedAt: snapshot.refreshedAt };
}

/** The addresses, or null when there is no snapshot or it can't be opened with this secret. */
export async function readRecipientEmails(store: OutageStore, secret = outageSecret()): Promise<string[] | null> {
  const snapshot = await readJson<StoredSnapshot>(store, RECIPIENTS_KEY);
  if (!snapshot || snapshot.v !== 1 || typeof snapshot.sealed !== "string") return null;
  try {
    const list = JSON.parse(openValue(snapshot.sealed, RECIPIENTS_LABEL, secret)) as unknown[];
    return Array.isArray(list) ? normalizeRecipients(list) : null;
  } catch {
    return null;
  }
}

export function snapshotIsStale(meta: RecipientMeta | null, now = Date.now()): boolean {
  if (!meta) return true;
  const refreshed = Date.parse(meta.refreshedAt);
  return !Number.isFinite(refreshed) || now - refreshed >= SNAPSHOT_STALE_MS;
}
