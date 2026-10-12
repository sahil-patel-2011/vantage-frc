import { withRls } from "@vantage/db";
import { readRecipientMeta, saveRecipientSnapshot, snapshotIsStale, type RecipientMeta } from "./recipients";
import { getOutageStore } from "./status-store";

/**
 * Take a fresh copy of the outage contact list while the database is healthy. Runs as the
 * signed-in platform admin, under RLS: list_service_notice_recipients() (0718) refuses anyone
 * who is not one.
 */

/** SQLSTATE 42883: the function isn't there because 0718 hasn't been applied. */
export class RecipientsMigrationMissingError extends Error {
  constructor() {
    super("The outage contact list needs database migration 0718_service_notice_recipients.sql.");
    this.name = "RecipientsMigrationMissingError";
  }
}

export async function refreshRecipientSnapshot(userId: string): Promise<RecipientMeta> {
  const emails = await withRls({ userId }, async (client) => {
    try {
      const result = await client.query<{ email: string }>("SELECT email FROM list_service_notice_recipients()");
      return result.rows.map((row) => row.email);
    } catch (error) {
      if ((error as { code?: unknown })?.code === "42883") throw new RecipientsMigrationMissingError();
      throw error;
    }
  });
  return saveRecipientSnapshot(getOutageStore(), emails, Date.now());
}

const CHECK_EVERY_MS = 10 * 60 * 1000;
let lastCheckedAt = 0;

/** From /api/me for a platform admin: refresh when the copy is missing or older than 12 h. */
export async function refreshRecipientSnapshotIfStale(userId: string): Promise<void> {
  const now = Date.now();
  if (now - lastCheckedAt < CHECK_EVERY_MS) return;
  lastCheckedAt = now;
  const meta = await readRecipientMeta(getOutageStore());
  if (!snapshotIsStale(meta, now)) return;
  await refreshRecipientSnapshot(userId);
}
