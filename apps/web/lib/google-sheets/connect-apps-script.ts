/**
 * Connect the Google copy through the team's own Apps Script web app (no Google Cloud).
 *
 * The owner pastes the web app address and the secret that is written into their script.
 * Vantage pings the script with a signed request first, so nothing is saved unless the
 * address is a real Apps Script deployment, open to "Anyone", running this version of the
 * script with this secret. The secret is then stored envelope-encrypted like a refresh token.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { encryptRefreshToken } from "../microsoft/connection-store";
import { type BridgeOptions, AppsScriptBridge, bridgeSpreadsheetId } from "./apps-script-bridge";
import { APPS_SCRIPT_DRIVE_VERSION, isAppsScriptSecret, isAppsScriptUrl } from "./apps-script-source";
import { saveGoogleConnection } from "./connection-store";
import { GoogleSheetsError, describeGoogleError } from "./google-api";

export type AppsScriptConnectInput = { url: unknown; secret: unknown };

export type AppsScriptCheck =
  | { ok: true; url: string; secret: string; name: string | null; fileUrl: string | null }
  | { ok: false; code: "bad_url" | "bad_secret" | "unreachable"; error: string };

/** Validate the pasted values and prove the script answers to them. No database access. */
export async function checkAppsScript(input: AppsScriptConnectInput, options: BridgeOptions = {}): Promise<AppsScriptCheck> {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const secret = typeof input.secret === "string" ? input.secret.trim().toLowerCase() : "";
  if (!isAppsScriptUrl(url)) {
    return {
      ok: false,
      code: "bad_url",
      error: "Paste the web app address from Deploy → Manage deployments. It starts with https://script.google.com/macros/s/ and ends with /exec.",
    };
  }
  if (!isAppsScriptSecret(secret)) {
    return { ok: false, code: "bad_secret", error: "The secret is the 64-character value on the VANTAGE_SECRET line of the script." };
  }
  try {
    const ping = await new AppsScriptBridge(url, secret, options).ping();
    // Only a Google Sheets address is kept as the file link.
    const fileUrl = ping.url && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(ping.url) ? ping.url : null;
    return { ok: true, url, secret, name: ping.name?.slice(0, 200) ?? null, fileUrl };
  } catch (error) {
    if (error instanceof GoogleSheetsError && error.code === "signature") {
      return {
        ok: false,
        code: "unreachable",
        error: "The script answered but refused this secret. Paste the exact value from the script's VANTAGE_SECRET line, or copy the script again and redeploy.",
      };
    }
    return { ok: false, code: "unreachable", error: describeGoogleError(error) };
  }
}

/** Save a checked connection, replacing any earlier Google connection for this team. */
export async function saveAppsScriptConnection(
  client: PoolClient,
  input: { orgId: string; userId: string; check: Extract<AppsScriptCheck, { ok: true }> },
): Promise<void> {
  await saveGoogleConnection(client, {
    orgId: input.orgId,
    userId: input.userId,
    refreshToken: await encryptRefreshToken(input.check.secret),
    account: { name: "Google Apps Script", email: null },
    spreadsheet: {
      spreadsheetId: bridgeSpreadsheetId(input.check.url),
      url: input.check.fileUrl ?? "",
      name: input.check.name ?? "Google Sheets (Apps Script)",
    },
  });
}

export type BridgeTestStep = { step: string; ok: boolean; detail?: string };

/** "Run a test" on the Google Sheets card: reach the script, then read the spreadsheet. */
export async function testSheetsBridge(bridge: AppsScriptBridge): Promise<{ passed: boolean; steps: BridgeTestStep[] }> {
  const steps: BridgeTestStep[] = [];
  let version: number;
  try {
    const ping = await bridge.ping();
    version = ping.version;
    steps.push({ step: "Reach your Google script", ok: true, detail: ping.name ? `Spreadsheet: ${ping.name}` : "It answered" });
  } catch (error) {
    steps.push({ step: "Reach your Google script", ok: false, detail: describeGoogleError(error) });
    return { passed: false, steps };
  }
  try {
    const data = await bridge.call<{ ok: boolean; values?: Record<string, unknown[][] | null> }>("read", { sheets: ["PickList"] });
    const rows = data.values?.PickList;
    steps.push({
      step: "Read the spreadsheet",
      ok: true,
      detail: rows ? `Pick list has ${Math.max(rows.length - 1, 0)} row(s)` : "Readable. Nothing synced yet: press Sync now",
    });
  } catch (error) {
    steps.push({ step: "Read the spreadsheet", ok: false, detail: describeGoogleError(error) });
  }
  steps.push({
    step: "Script version",
    ok: true,
    detail: version >= APPS_SCRIPT_DRIVE_VERSION ? "Up to date" : "Works for the spreadsheet. Copy the new script to add photos and videos",
  });
  return { passed: steps.every((step) => step.ok), steps };
}
