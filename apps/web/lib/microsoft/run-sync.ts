/**
 * "Sync now", end to end, on one withRls client: decrypt the team's refresh token, get an
 * access token (persisting the rotated refresh token), open the workbook, and hand off to
 * syncOrgWorkbook. Kept out of the route so the route stays a thin auth + rate-limit shell.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  readConnectionSecret,
  readWorkbookNaming,
  recordConnectionError,
  storeRotatedRefreshToken,
  storeWorkbookLocation,
} from "./connection-store";
import { GraphClient, type MicrosoftConfig, type RetryOptions, describeGraphError, isGraphError, refreshMicrosoftTokens } from "./graph";
import { GraphWorkbookTarget, ensureWorkbookFile, workbookFileName } from "./workbook-target";
import { type SyncResult, syncOrgWorkbook } from "./workbook-sync";

export type ConnectFailure =
  | { status: "not_connected" }
  | { status: "reconnect_required"; error: string }
  | { status: "encryption_unavailable"; error: string }
  | { status: "microsoft_unavailable"; error: string };

export type RunSyncResult = SyncResult | ConnectFailure;

type ConnectionSecret = NonNullable<Awaited<ReturnType<typeof readConnectionSecret>>>;

/**
 * The team's stored sign-in → a Graph client. Shared by Sync now and Import: decrypt the
 * refresh token, redeem it (storing the rotated one), and record any failure on the
 * connection so the card can show it.
 */
export async function connectMicrosoftGraph(
  client: PoolClient,
  input: { orgId: string; config: MicrosoftConfig; retry?: RetryOptions },
): Promise<{ status: "ok"; graph: GraphClient; secret: ConnectionSecret } | ConnectFailure> {
  const secret = await readConnectionSecret(client, input.orgId);
  if (!secret) return { status: "not_connected" };

  let refreshToken: string;
  try {
    refreshToken = await decryptRefreshToken(secret.refreshToken);
  } catch {
    const error = "Vantage could not decrypt the saved Microsoft sign-in (encryption keys changed). Reconnect Microsoft.";
    await recordConnectionError(client, input.orgId, error);
    return { status: "encryption_unavailable", error };
  }

  let accessToken: string;
  try {
    const tokens = await refreshMicrosoftTokens(input.config, refreshToken, input.retry);
    accessToken = tokens.accessToken;
    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      await storeRotatedRefreshToken(client, input.orgId, await encryptRefreshToken(tokens.refreshToken));
    }
  } catch (error) {
    const message = describeGraphError(error);
    await recordConnectionError(client, input.orgId, message);
    if (isGraphError(error) && error.kind === "auth_expired") return { status: "reconnect_required", error: message };
    // Recorded, not thrown: throwing would roll the recorded error back with the transaction.
    return { status: "microsoft_unavailable", error: message };
  }

  return { status: "ok", graph: new GraphClient(accessToken, input.retry), secret };
}

export async function runWorkbookSync(
  client: PoolClient,
  input: { orgId: string; userId: string; config: MicrosoftConfig; retry?: RetryOptions },
): Promise<RunSyncResult> {
  const connected = await connectMicrosoftGraph(client, input);
  if (connected.status !== "ok") return connected;
  const { graph, secret } = connected;

  const openTarget = async () => {
    let itemId = secret.workbookItemId;
    if (itemId) {
      try {
        return await GraphWorkbookTarget.open(graph, itemId);
      } catch (error) {
        // The file was deleted or moved out of reach: recreate it where it belongs.
        if (!isGraphError(error) || error.kind !== "not_found") throw error;
      }
    }
    const naming = await readWorkbookNaming(client, input.orgId);
    const file = await ensureWorkbookFile(graph, secret.workbookName ?? workbookFileName(naming));
    await storeWorkbookLocation(client, input.orgId, file);
    itemId = file.itemId;
    return GraphWorkbookTarget.open(graph, itemId);
  };

  return syncOrgWorkbook(client, input.orgId, { openTarget, userId: input.userId });
}
