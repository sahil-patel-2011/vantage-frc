/**
 * The two copies as MirrorTargetDefs, plus reading which copies a team has.
 *
 * Each def connects lazily inside `open()`, so a copy whose sign-in has expired fails on
 * its own and never blocks the other copy from being written.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepointOrThrow } from "@vantage/db";
import { type GoogleSheetsConfig, describeGoogleError, getGoogleSheetsConfig, isGoogleSheetsError } from "../google-sheets/google-api";
import { isMirrorNotMigrated } from "../google-sheets/connection-store";
import { connectGoogleSheets, openGoogleTarget } from "../google-sheets/run-google";
import { type MicrosoftConfig, describeGraphError, getMicrosoftConfig, isGraphError } from "../microsoft/graph";
import { connectMicrosoftGraph } from "../microsoft/run-sync";
import { readWorkbookNaming, storeWorkbookLocation } from "../microsoft/connection-store";
import { GraphWorkbookTarget, ensureWorkbookFile, workbookFileName } from "../microsoft/workbook-target";
import type { WorkbookTarget } from "../microsoft/workbook-sync";
import type { MirrorCopy } from "./mirror-hash";
import type { MirrorTargetDef } from "./mirror-sync";

export type CopyState = {
  copy: MirrorCopy;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncHash: string | null;
  lastReadAt: string | null;
  throttledUntil: string | null;
  lastError: string | null;
  fileUrl: string | null;
  fileName: string | null;
  account: string | null;
};

/** What each copy looks like right now, from the member-readable status views. */
export async function readCopyStates(client: PoolClient, orgId: string): Promise<{ migrated: boolean; copies: CopyState[] }> {
  try {
    const [excel, google] = await withSavepointOrThrow(client, async () => [
      (
        await client.query<Omit<CopyState, "copy" | "connected">>(
          `SELECT last_sync_at::text AS "lastSyncAt", last_sync_hash AS "lastSyncHash", last_read_at::text AS "lastReadAt",
                  throttled_until::text AS "throttledUntil", last_error AS "lastError",
                  workbook_web_url AS "fileUrl", workbook_name AS "fileName",
                  COALESCE(account_email, account_name) AS account
             FROM org_microsoft_connection_status WHERE org_id = $1::uuid LIMIT 1`,
          [orgId],
        )
      ).rows[0],
      (
        await client.query<Omit<CopyState, "copy" | "connected">>(
          `SELECT last_sync_at::text AS "lastSyncAt", last_sync_hash AS "lastSyncHash", last_read_at::text AS "lastReadAt",
                  throttled_until::text AS "throttledUntil", last_error AS "lastError",
                  spreadsheet_url AS "fileUrl", spreadsheet_name AS "fileName",
                  COALESCE(account_email, account_name) AS account
             FROM org_google_sheets_connection_status WHERE org_id = $1::uuid LIMIT 1`,
          [orgId],
        )
      ).rows[0],
    ]);
    const shape = (copy: MirrorCopy, row: Omit<CopyState, "copy" | "connected"> | undefined): CopyState => ({
      copy,
      connected: Boolean(row),
      lastSyncAt: row?.lastSyncAt ?? null,
      lastSyncHash: row?.lastSyncHash ?? null,
      lastReadAt: row?.lastReadAt ?? null,
      throttledUntil: row?.throttledUntil ?? null,
      lastError: row?.lastError ?? null,
      fileUrl: row?.fileUrl ?? null,
      fileName: row?.fileName ?? null,
      account: row?.account ?? null,
    });
    return { migrated: true, copies: [shape("excel", excel), shape("google", google)] };
  } catch (error) {
    if (!isMirrorNotMigrated(error)) throw error;
    return { migrated: false, copies: [] };
  }
}

export function excelTargetDef(
  client: PoolClient,
  orgId: string,
  config: MicrosoftConfig,
  throttledUntil: string | null,
): MirrorTargetDef {
  return {
    copy: "excel",
    throttledUntil,
    describe: (error) => (error instanceof MirrorConnectError ? error.message : describeGraphError(error)),
    isFatal: (error) => isGraphError(error) && error.kind === "auth_expired",
    throttle: (error) => (isGraphError(error) && error.kind === "throttled" ? (error.retryAfterMs ?? 0) : null),
    async open(): Promise<WorkbookTarget> {
      const connected = await connectMicrosoftGraph(client, { orgId, config });
      if (connected.status !== "ok") throw new MirrorConnectError(connected.status, "error" in connected ? connected.error : null);
      const { graph, secret } = connected;
      if (secret.workbookItemId) {
        try {
          return await GraphWorkbookTarget.open(graph, secret.workbookItemId);
        } catch (error) {
          if (!isGraphError(error) || error.kind !== "not_found") throw error;
        }
      }
      const naming = await readWorkbookNaming(client, orgId);
      const file = await ensureWorkbookFile(graph, secret.workbookName ?? workbookFileName(naming));
      await storeWorkbookLocation(client, orgId, file);
      return GraphWorkbookTarget.open(graph, file.itemId);
    },
  };
}

export function googleTargetDef(
  client: PoolClient,
  orgId: string,
  config: GoogleSheetsConfig,
  throttledUntil: string | null,
): MirrorTargetDef {
  return {
    copy: "google",
    throttledUntil,
    describe: (error) => (error instanceof MirrorConnectError ? error.message : describeGoogleError(error)),
    isFatal: (error) => isGoogleSheetsError(error) && (error.kind === "auth_expired" || error.kind === "api_disabled"),
    throttle: (error) => (isGoogleSheetsError(error) && error.kind === "throttled" ? (error.retryAfterMs ?? 0) : null),
    async open(): Promise<WorkbookTarget> {
      const connected = await connectGoogleSheets(client, { orgId, config });
      if (connected.status !== "ok") throw new MirrorConnectError(connected.status, "error" in connected ? connected.error : null);
      return openGoogleTarget(client, orgId, connected.sheets, connected.secret);
    },
  };
}

/** A copy could not even be opened (not connected, sign-in expired, keys changed). */
export class MirrorConnectError extends Error {
  constructor(
    readonly reason: string,
    detail: string | null,
  ) {
    super(detail ?? (reason === "not_connected" ? "This copy is not connected." : "Could not open this copy."));
    this.name = "MirrorConnectError";
  }
}

/** Every connected copy the server is configured for, in a stable order (Excel, then Google). */
export function connectedTargetDefs(client: PoolClient, orgId: string, states: CopyState[]): MirrorTargetDef[] {
  const defs: MirrorTargetDef[] = [];
  const microsoft = getMicrosoftConfig();
  const google = getGoogleSheetsConfig();
  for (const state of states) {
    if (!state.connected) continue;
    if (state.copy === "excel" && microsoft) defs.push(excelTargetDef(client, orgId, microsoft, state.throttledUntil));
    if (state.copy === "google" && google) defs.push(googleTargetDef(client, orgId, google, state.throttledUntil));
  }
  return defs;
}
