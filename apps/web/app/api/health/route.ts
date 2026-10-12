import { isBackupMode } from "@vantage/db/backup-mode";
import { probeDatabase, reportProbeOutcome } from "../../../lib/outage/probe";

export const dynamic = "force-dynamic";

/**
 * Uptime check for a monitor (Vercel, UptimeRobot, a status page): 200 when the app can reach its
 * database, 503 when it cannot. It says only that, never which host, driver or error, so it is
 * safe to leave public.
 *
 * After answering, it tells the outage tracker (lib/outage/incident.ts) what it found: the first
 * failure emails the owner why, and the first success after an outage emails that it is back.
 * An external monitor hitting this every few minutes is what catches an outage when nobody is
 * using the app (docs/NAS_DATABASE.md, "When the NAS goes down").
 */
export async function GET() {
  // Backup mode: no database on purpose. Still a 503 (the database really isn't there), but it
  // says why, so a monitor's owner isn't left guessing, and nothing is probed or reported.
  if (isBackupMode()) {
    return Response.json({ ok: false, database: "backup_mode" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const probe = await probeDatabase();
  reportProbeOutcome(probe, "api/health");
  const ok = probe.ok;
  return Response.json(
    { ok, database: ok ? "ok" : "unreachable", checkedInMs: probe.ms },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
