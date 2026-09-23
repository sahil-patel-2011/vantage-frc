/**
 * Import from the spreadsheet copies: read every copy that is up, merge (mirror-merge.ts),
 * then preview and apply through the ordinary Excel import pipeline, which cannot tell a
 * merged read from a single workbook.
 *
 * If one provider is down, throttled or signed out, the import still runs on the other and
 * says which copy it skipped — edits made only in the skipped copy are picked up the next
 * time it is readable, because the import never deletes and the copy keeps them.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { describeGoogleError, getGoogleSheetsConfig, isGoogleSheetsError } from "../google-sheets/google-api";
import { openGoogleCopy } from "../google-sheets/run-google";
import { describeGraphError, getMicrosoftConfig, isGraphError } from "../microsoft/graph";
import {
  type ApplyResult,
  type PublicPreview,
  type Reads,
  applyWorkbookImport,
  buildImportPreview,
  importTableReady,
  readImportTables,
  toPublicPreview,
} from "../microsoft/run-import";
import { connectMicrosoftGraph } from "../microsoft/run-sync";
import type { WorkbookReader } from "../microsoft/workbook-import";
import { GraphWorkbookTarget } from "../microsoft/workbook-target";
import { isDatabaseError } from "../security/public-error";
import { type MirrorCopy, mirrorCopyLabel } from "./mirror-hash";
import { type CopyRead, type MergeResult, type MirrorConflict, importReadPlan, mergeCopyReads } from "./mirror-merge";
import { clampThrottle } from "./mirror-sync";
import { readCopyStates } from "./mirror-targets";

export type Skipped = { copy: MirrorCopy; reason: string };

export type MirrorImportFailure =
  | { status: "not_migrated" }
  | { status: "not_connected" }
  | { status: "no_copy_available"; skipped: Skipped[] };

export type MirrorImportPreview = {
  status: "ok";
  preview: PublicPreview;
  conflicts: MirrorConflict[];
  read: MirrorCopy[];
  skipped: Skipped[];
  editSources: MergeResult["editSources"];
};

const CONNECTION_TABLE: Record<MirrorCopy, string> = {
  excel: "org_microsoft_connections",
  google: "org_google_sheets_connections",
};

async function openReader(client: PoolClient, orgId: string, copy: MirrorCopy): Promise<WorkbookReader> {
  if (copy === "excel") {
    const config = getMicrosoftConfig();
    if (!config) throw new Error("Microsoft is not configured on this server.");
    const connected = await connectMicrosoftGraph(client, { orgId, config });
    if (connected.status !== "ok") throw new Error("error" in connected ? connected.error : "Excel is not connected.");
    if (!connected.secret.workbookItemId) throw new Error("The Excel workbook has not been created yet — sync first.");
    return GraphWorkbookTarget.open(connected.graph, connected.secret.workbookItemId, { persistChanges: false });
  }
  // Apps Script bridge or Sheets API sign-in; an import never creates a spreadsheet.
  const opened = await openGoogleCopy(client, { orgId, config: getGoogleSheetsConfig(), createIfMissing: false });
  if ("status" in opened) throw new Error("error" in opened ? opened.error : "Google Sheets is not connected.");
  return opened;
}

function throttleOf(error: unknown): number | null {
  if (isGraphError(error) && error.kind === "throttled") return error.retryAfterMs ?? 0;
  if (isGoogleSheetsError(error) && error.kind === "throttled") return error.retryAfterMs ?? 0;
  return null;
}

/** Read every usable copy; record reads and throttles on the connection rows. */
async function readCopies(
  client: PoolClient,
  orgId: string,
  now: () => Date,
): Promise<{ reads: Array<{ copy: MirrorCopy; reads: Reads }>; skipped: Skipped[] } | MirrorImportFailure> {
  const states = await readCopyStates(client, orgId);
  if (!states.migrated) return { status: "not_migrated" };
  if (!states.copies.some((state) => state.connected)) return { status: "not_connected" };
  const plan = importReadPlan(states.copies, now());
  const skipped: Skipped[] = [...plan.skipped];
  const reads: Array<{ copy: MirrorCopy; reads: Reads }> = [];

  for (const copy of plan.read) {
    let reader: WorkbookReader | null = null;
    try {
      reader = await openReader(client, orgId, copy);
      const read = await readImportTables(reader);
      reads.push({ copy, reads: read });
      await client.query(`UPDATE ${CONNECTION_TABLE[copy]} SET last_read_at = $2::timestamptz WHERE org_id = $1::uuid`, [
        orgId,
        now().toISOString(),
      ]);
    } catch (error) {
      // A Postgres error is not a copy being down: let it abort the request as usual.
      if (isDatabaseError(error)) throw error;
      const wait = throttleOf(error);
      if (wait !== null) {
        await client.query(
          `UPDATE ${CONNECTION_TABLE[copy]} SET throttled_until = $2::timestamptz, updated_at = now() WHERE org_id = $1::uuid`,
          [orgId, new Date(now().getTime() + clampThrottle(wait)).toISOString()],
        );
      }
      skipped.push({
        copy,
        reason:
          wait !== null
            ? "the provider asked Vantage to slow down"
            : isGraphError(error)
              ? describeGraphError(error)
              : isGoogleSheetsError(error)
                ? describeGoogleError(error)
                : error instanceof Error
                  ? error.message
                  : "it could not be read",
      });
    } finally {
      await reader?.close().catch(() => undefined);
    }
  }
  if (reads.length === 0) return { status: "no_copy_available", skipped };
  return { reads, skipped };
}

async function mergeAll(client: PoolClient, orgId: string, reads: Array<{ copy: MirrorCopy; reads: Reads }>) {
  const copies: CopyRead[] = [];
  for (const entry of reads) {
    const { preview } = await buildImportPreview(client, orgId, entry.reads);
    copies.push({ copy: entry.copy, reads: entry.reads, preview });
  }
  return mergeCopyReads(copies);
}

function memoryReader(reads: Reads): WorkbookReader {
  return {
    async readTable(ref) {
      return reads[ref.entity] ?? null;
    },
    async close() {},
  };
}

export async function runMirrorImportPreview(
  client: PoolClient,
  input: { orgId: string; now?: () => Date },
): Promise<MirrorImportPreview | MirrorImportFailure> {
  const now = input.now ?? (() => new Date());
  if (!(await importTableReady(client))) return { status: "not_migrated" };
  const read = await readCopies(client, input.orgId, now);
  if ("status" in read) return read;
  const merged = await mergeAll(client, input.orgId, read.reads);
  const { preview } = await buildImportPreview(client, input.orgId, merged.reads);
  return {
    status: "ok",
    preview: toPublicPreview(preview),
    conflicts: merged.conflicts,
    read: read.reads.map((entry) => entry.copy),
    skipped: read.skipped,
    editSources: merged.editSources,
  };
}

export async function runMirrorImportApply(
  client: PoolClient,
  input: { orgId: string; userId: string; changeIds: string[]; now?: () => Date },
): Promise<
  | { status: "applied"; result: ApplyResult; read: MirrorCopy[]; skipped: Skipped[]; conflicts: MirrorConflict[] }
  | MirrorImportFailure
> {
  const now = input.now ?? (() => new Date());
  if (!(await importTableReady(client))) return { status: "not_migrated" };
  const read = await readCopies(client, input.orgId, now);
  if ("status" in read) return read;
  const merged = await mergeAll(client, input.orgId, read.reads);
  const result = await applyWorkbookImport(client, {
    orgId: input.orgId,
    userId: input.userId,
    changeIds: input.changeIds,
    openReader: async () => memoryReader(merged.reads),
    now,
  });
  return {
    status: "applied",
    result,
    read: read.reads.map((entry) => entry.copy),
    skipped: read.skipped,
    conflicts: merged.conflicts,
  };
}

export function describeSkipped(skipped: Skipped[]): string | null {
  if (!skipped.length) return null;
  return skipped.map((entry) => `${mirrorCopyLabel(entry.copy)} was skipped: ${entry.reason}.`).join(" ");
}
