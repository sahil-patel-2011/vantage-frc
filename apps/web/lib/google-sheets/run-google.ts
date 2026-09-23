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
