import type { PoolClient } from "@neondatabase/serverless";
import { isGoogleSheetsError } from "../google-sheets/google-api";

export async function recordProviderWait(client: PoolClient, orgId: string, error: unknown, now = Date.now()): Promise<number | null> {
  if (!isGoogleSheetsError(error) || error.kind !== "throttled") return null;
  const fallback = error.code === "daily_quota" ? 86_400_000 : 30_000;
  const suggested = error.retryAfterMs;
  const retryMs = Math.max(1000, Math.min(86_400_000, suggested !== null && Number.isFinite(suggested) ? suggested : fallback));
  const message = error.code === "daily_quota"
    ? "Google's daily creation allowance is in use. Progress is saved; setup will retry automatically."
    : "Google asked us to slow down. Progress is saved; setup will retry automatically.";
  await client.query(`UPDATE team_provisioning_jobs SET state='waiting',error=$2,retry_after_at=$3::timestamptz,updated_at=now()
    WHERE org_id=$1::uuid AND state<>'ready'`, [orgId, message, new Date(now + retryMs).toISOString()]);
  return retryMs;
}
