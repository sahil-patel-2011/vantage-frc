import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import type { SyncEntry } from "@vantage/scouting";

/** Personal inbox receipts after a server save; no email, fan-out, or new schema. */
export async function recordScoutSyncNotifications(client: PoolClient, orgId: string, userId: string,
  acks: readonly { clientId: string; entryId?: string | null }[], entries: readonly SyncEntry[]) {
  const byClient = new Map(entries.map(entry => [entry.clientId, entry]));
  const receipts = acks.flatMap(ack => {
    const entry = byClient.get(ack.clientId);
    return !entry || !ack.entryId ? [] : [{ entryId: ack.entryId, eventKey: entry.eventKey,
      title: `${entry.type === "pit" ? "Pit" : "Match"} report for team ${entry.teamKey.replace(/^frc/, "")} synced`,
      body: "Saved to your team's records and ready to use in scouting and pick lists.",
      href: `/competition?tab=scouting&scoutTab=${entry.type}&eventKey=${encodeURIComponent(entry.eventKey)}&orgId=${encodeURIComponent(orgId)}` }];
  });
  if (!receipts.length) return;
  // A notification failure cannot roll back a valid report or clear an uncommitted outbox.
  await withSavepoint(client, async () => {
    await client.query(
      `INSERT INTO notifications(user_id, org_id, type, payload)
       SELECT $1::uuid, $2::uuid, 'scout_report_synced', receipt
       FROM jsonb_array_elements($3::jsonb) AS saved(receipt)
       WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE user_id=$1::uuid
         AND notification_prefs->'scoutReminders'='false'::jsonb)
       AND NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=$1::uuid AND org_id=$2::uuid
         AND type='scout_report_synced' AND payload->>'entryId'=receipt->>'entryId')`,
      [userId, orgId, JSON.stringify(receipts)],
    );
    return true;
  }, false);
}
