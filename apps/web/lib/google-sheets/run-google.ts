/**
 * The team's stored Google sign-in → a Sheets client and the team's spreadsheet. Mirrors
 * connectMicrosoftGraph: decrypt the refresh token, redeem it (keeping a rotated one), and
 * record any failure on the connection so the Connectors card can show it.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { decryptRefreshToken, encryptRefreshToken, readWorkbookNaming } from "../microsoft/connection-store";
import { workbookFileName } from "../microsoft/workbook-target";
import {
  type GoogleRetryOptions,
  type GoogleSheetsConfig,
  GoogleSheetsClient,
  describeGoogleError,
  isGoogleSheetsError,
  refreshGoogleTokens,
} from "./google-api";
import {
  readGoogleConnectionSecret,
  recordGoogleError,
  storeGoogleRefreshToken,
  storeSpreadsheetLocation,
} from "./connection-store";
import { GoogleSheetsTarget, createSpreadsheet } from "./sheets-target";
import { AppsScriptBridge, AppsScriptTarget, bridgeUrlOf } from "./apps-script-bridge";
import type { WorkbookReader } from "../microsoft/workbook-import";
import type { WorkbookTarget } from "../microsoft/workbook-sync";

export type GoogleConnectFailure =
  | { status: "not_connected" }
  | { status: "reconnect_required"; error: string }
  | { status: "encryption_unavailable"; error: string }
  | { status: "google_unavailable"; error: string };

type Secret = NonNullable<Awaited<ReturnType<typeof readGoogleConnectionSecret>>>;

export async function connectGoogleSheets(
  client: PoolClient,
  input: { orgId: string; config: GoogleSheetsConfig; retry?: GoogleRetryOptions },
): Promise<{ status: "ok"; sheets: GoogleSheetsClient; secret: Secret } | GoogleConnectFailure> {
  const secret = await readGoogleConnectionSecret(client, input.orgId);
  if (!secret) return { status: "not_connected" };

  let refreshToken: string;
  try {
    refreshToken = await decryptRefreshToken(secret.refreshToken);
  } catch {
    const error = "Vantage could not decrypt the saved Google sign-in (encryption keys changed). Reconnect Google Sheets.";
    await recordGoogleError(client, input.orgId, error);
    return { status: "encryption_unavailable", error };
  }

  try {
    const tokens = await refreshGoogleTokens(input.config, refreshToken, input.retry);
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      await storeGoogleRefreshToken(client, input.orgId, await encryptRefreshToken(tokens.refreshToken));
    }
    return { status: "ok", sheets: new GoogleSheetsClient(tokens.accessToken, input.retry), secret };
  } catch (error) {
    const message = describeGoogleError(error);
    await recordGoogleError(client, input.orgId, message);
    if (isGoogleSheetsError(error) && error.kind === "auth_expired") return { status: "reconnect_required", error: message };
    return { status: "google_unavailable", error: message };
  }
}

/**
 * The team's Google copy, whichever way it is connected: through its own Apps Script web app
 * (no Google Cloud project — apps-script-bridge.ts) or through the Sheets API with an OAuth
 * sign-in. Both implement the same write and read interfaces.
 */
export async function openGoogleCopy(
  client: PoolClient,
  input: { orgId: string; config: GoogleSheetsConfig | null; retry?: GoogleRetryOptions; createIfMissing?: boolean },
): Promise<(WorkbookTarget & WorkbookReader) | GoogleConnectFailure> {
  const secret = await readGoogleConnectionSecret(client, input.orgId);
  if (!secret) return { status: "not_connected" };
  const bridgeUrl = bridgeUrlOf(secret.spreadsheetId);
  if (bridgeUrl) {
    let shared: string;
    try {
      shared = await decryptRefreshToken(secret.refreshToken);
    } catch {
      const error = "Vantage could not decrypt the saved Apps Script secret (encryption keys changed). Set the script up again from Connectors.";
      await recordGoogleError(client, input.orgId, error);
      return { status: "encryption_unavailable", error };
    }
    const bridge = new AppsScriptBridge(bridgeUrl, shared);
    // Keep the card's name and link current when the owner renames the spreadsheet in
    // Google (File → Rename). A failed ping is not fatal: the write reports the real error.
    try {
      const ping = await bridge.ping();
      const name = ping.name?.slice(0, 200);
      if (name && name !== secret.spreadsheetName && secret.spreadsheetId) {
        await storeSpreadsheetLocation(client, input.orgId, {
          spreadsheetId: secret.spreadsheetId,
          url: ping.url && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(ping.url) ? ping.url : "",
          name,
        });
      }
    } catch {
      // fall through to the write
    }
    return new AppsScriptTarget(bridge);
  }
  if (!input.config) {
    return { status: "google_unavailable", error: "Google Sheets sign-in is not set up on this server. Connect through Apps Script instead." };
  }
  if (!secret.spreadsheetId && input.createIfMissing === false) {
    return { status: "google_unavailable", error: "The Google spreadsheet has not been created yet — sync first." };
  }
  const connected = await connectGoogleSheets(client, { orgId: input.orgId, config: input.config, retry: input.retry });
  if (connected.status !== "ok") return connected;
  return openGoogleTarget(client, input.orgId, connected.sheets, connected.secret);
}

/** Open the team's spreadsheet, creating it (and remembering it) when it is missing. */
export async function openGoogleTarget(
  client: PoolClient,
  orgId: string,
  sheets: GoogleSheetsClient,
  secret: Secret,
): Promise<GoogleSheetsTarget> {
  if (secret.spreadsheetId) {
    try {
      return await GoogleSheetsTarget.open(sheets, secret.spreadsheetId);
    } catch (error) {
      // Deleted or no longer reachable: make a new one where it belongs.
      if (!isGoogleSheetsError(error) || error.kind !== "not_found") throw error;
    }
  }
  const naming = await readWorkbookNaming(client, orgId);
  const title = (secret.spreadsheetName ?? workbookFileName(naming)).replace(/\.xlsx$/i, "");
  const created = await createSpreadsheet(sheets, title);
  await storeSpreadsheetLocation(client, orgId, created);
  return GoogleSheetsTarget.open(sheets, created.spreadsheetId);
}
