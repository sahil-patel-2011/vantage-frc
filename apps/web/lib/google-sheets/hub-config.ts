/** Configuration and transport only: no database, session or provider IO.
 * This does not make Sheets the primary store or authorize any data operation.
 */
import { AppsScriptBridge } from "./apps-script-bridge";
import { isAppsScriptSecret, isAppsScriptUrl } from "./apps-script-source";

export type SheetsHubConfig = { url: string; secret: string };

/** Valid environment configuration wins; legacy registered addresses remain a fallback. */
export function sheetsHubConfig(
  env: NodeJS.ProcessEnv = process.env,
  registeredUrl: string | null = null,
): SheetsHubConfig | null {
  const fromEnv = env.VANTAGE_SHEETS_HUB_URL?.trim() ?? "";
  const url = isAppsScriptUrl(fromEnv) ? fromEnv : (registeredUrl?.trim() ?? "");
  const secret = env.VANTAGE_SHEETS_HUB_SECRET?.trim().toLowerCase() ?? "";
  if (!isAppsScriptUrl(url) || !isAppsScriptSecret(secret)) return null;
  return { url, secret };
}

export function sheetsHubBridge(config: SheetsHubConfig | null = sheetsHubConfig()): AppsScriptBridge | null {
  return config ? new AppsScriptBridge(config.url, config.secret) : null;
}
