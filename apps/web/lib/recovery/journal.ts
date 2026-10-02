import { randomUUID } from "node:crypto";
import { provisioningPool } from "../provisioning/pool";
import { loadSheetsHubBridge } from "../google-sheets/sheets-hub";
import { writeRecoveryRecord } from "./sheets";
import { FatalError, RetryableError } from "workflow";
import { isGoogleSheetsError } from "../google-sheets/google-api";

/** IDs are acknowledged separately, including transactions which commit after later IDs. */
export async function exportRecoveryJournal() {
  "use step";
  const client = await provisioningPool().connect();
  let locked = false;
  let checkpointId: string | null = null;
  try {
    locked = (await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('recovery:journal',0)) AS locked")).rows[0]?.locked ?? false;
    if (!locked) return { state: "busy" as const };
    const missing = await client.query("SELECT 1 FROM recovery_coverage WHERE NOT rows_covered OR NOT truncation_covered LIMIT 1");
    if (missing.rowCount) throw new FatalError("A durable table is missing recovery capture.");
    // Select whole transactions. JSON values remain raw strings so bigint/numeric and
    // timestamp precision survive the JS and Sheets transport.
    const events = await client.query<{ id: string; record: string }>(`SELECT id::text,row_to_json(e)::text AS record FROM recovery_events e
      WHERE exported_at IS NULL AND transaction_id IN (
        SELECT transaction_id FROM recovery_events WHERE exported_at IS NULL GROUP BY transaction_id ORDER BY min(id) LIMIT 500)
      ORDER BY id`);
    if (!events.rowCount) return { state: "current" as const, events: 0 };
    const bridge = await loadSheetsHubBridge(client);
    // Setup can change between dispatch and execution. Leave every event pending.
    if (!bridge) return { state: "not_configured" as const };
    checkpointId = randomUUID();
    await client.query("INSERT INTO recovery_checkpoints(id,kind,state) VALUES($1::uuid,'journal','writing')", [checkpointId]);
    const text = JSON.stringify({ version: 1, kind: "journal", id: checkpointId, createdAt: new Date().toISOString(), events: events.rows.map((row) => row.record) });
    const day = new Date().toISOString().slice(0, 10);
    // At most 64 batches per book. Allocation uses the database's persistent sequence,
    // rather than a process counter, so worker restarts preserve shard boundaries.
    const count = (await client.query<{ count: string }>("SELECT count(*)::text AS count FROM recovery_checkpoints WHERE kind='journal' AND created_at::date=CURRENT_DATE")).rows[0]!.count;
    const resource = await writeRecoveryRecord(bridge, `Journal-${day}-${Math.floor((Number(count) - 1) / 64)}`, checkpointId, text);
    await client.query("BEGIN");
    await client.query("UPDATE recovery_events SET exported_at=now(),export_batch=$2::uuid WHERE id=ANY($1::bigint[]) AND exported_at IS NULL", [events.rows.map((row) => row.id), checkpointId]);
    await client.query("UPDATE recovery_checkpoints SET state='verified',verified_at=now(),resources=$2::jsonb,integrity_hash=$3 WHERE id=$1::uuid", [checkpointId, JSON.stringify(resource), resource.hash]);
    await client.query("COMMIT");
    return { state: "verified" as const, events: events.rowCount, checkpointId };
  } catch (error) {
    await client.query("ROLLBACK");
    if (checkpointId) await client.query("UPDATE recovery_checkpoints SET state='failed',error='Recovery write or verification failed.' WHERE id=$1::uuid", [checkpointId]);
    if (isGoogleSheetsError(error) && error.kind === "throttled") {
      const suggested = error.retryAfterMs;
      const fallback = error.code === "daily_quota" ? 86_400_000 : 30_000;
      const retryAfter = Math.max(1000, Math.min(86_400_000, suggested !== null && Number.isFinite(suggested) ? suggested : fallback));
      throw new RetryableError("Google recovery is waiting for its provider allowance.", { retryAfter });
    }
    if (isGoogleSheetsError(error) && error.kind !== "unavailable") {
      throw new FatalError("Google recovery needs its connection or request corrected.");
    }
    throw error;
  } finally {
    try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended('recovery:journal',0))"); }
    finally { client.release(); }
  }
}
exportRecoveryJournal.maxRetries = 5;
