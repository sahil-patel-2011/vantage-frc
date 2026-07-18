import { requestPool } from "@vantage/db";

/**
 * After a TBA event-day sync, fan out match_alert inbox rows when our team's
 * schedule fingerprint changes. Uses SECURITY DEFINER emit_match_schedule_alerts
 * so cron (no session user) can notify members while respecting matchAlerts prefs.
 */
export async function notifyMatchScheduleAfterSync(eventKeys: string[]): Promise<number> {
  const keys = [...new Set(eventKeys.filter((key) => typeof key === "string" && key.length > 0))];
  if (keys.length === 0) return 0;
  try {
    const result = await requestPool.query<{ emitted: number }>(
      `SELECT emit_match_schedule_alerts($1::text[]) AS emitted`,
      [keys],
    );
    return Number(result.rows[0]?.emitted ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/emit_match_schedule_alerts|does not exist/i.test(message)) return 0;
    console.error("[tba-sync] match schedule notify failed", error);
    return 0;
  }
}