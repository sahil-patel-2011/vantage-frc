import { isAppsScriptSecret } from "../google-sheets/apps-script-source";
import { loadSheetsHubBridge } from "../google-sheets/sheets-hub";
import { provisioningPool } from "../provisioning/pool";

/** Check outside the workflow: an idle or unconfigured tick must not create paid events. */
export async function recoveryJournalReadiness(): Promise<"ready" | "not_configured" | "current"> {
  if (!isAppsScriptSecret(process.env.VANTAGE_SHEETS_HUB_SECRET?.trim().toLowerCase() ?? "")) return "not_configured";
  const client = await provisioningPool().connect();
  try {
    if (!await loadSheetsHubBridge(client)) return "not_configured";
    const pending = await client.query("SELECT 1 FROM recovery_events WHERE exported_at IS NULL LIMIT 1");
    return pending.rowCount ? "ready" : "current";
  } finally { client.release(); }
}
