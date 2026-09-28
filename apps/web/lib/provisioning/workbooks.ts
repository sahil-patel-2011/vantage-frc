import { AppsScriptBridge, AppsScriptTarget, type HubTeam, type HubTeamBook } from "../google-sheets/apps-script-bridge";
import { buildSyncInfoTable, WORKBOOK_SCHEMA_VERSION, type BuiltTable, type WorkbookSource } from "../microsoft/workbook-schema";
import { buildAllTables, buildCatalogTable } from "../microsoft/team-ops-tables";
import { contentHash } from "../mirror/mirror-hash";
import { isGoogleSheetsError } from "../google-sheets/google-api";
import { unescapeCell } from "../microsoft/workbook-import";
import type { WorkspaceWorkbookName } from "./model";
import { shardWorkbookCells } from "../microsoft/long-text";
import { createHash } from "node:crypto";

export function verifyWorkbookTables(tables: readonly BuiltTable[], read: Record<string, unknown[][]> | undefined, metadataMayBeOlder = false) {
  for (const table of tables) {
    const values = read?.[table.spec.sheet];
    if (!values || table.spec.columns.some((column, index) => values[0]?.[index] !== column) || values.length - 1 !== table.rows.length) throw new Error(`Google table verification failed: ${table.spec.sheet}.`);
    const normalize = (cell: unknown) => cell == null ? "" : typeof cell === "string" ? unescapeCell(cell) : cell;
    if (table.rows.some((row, rowIndex) => row.some((cell, columnIndex) => {
      const column = table.spec.columns[columnIndex];
      if (metadataMayBeOlder && ((table.spec.entity === "Tables" && column === "updated_at") || (table.spec.entity === "SyncInfo" && (column === "updated_at" || (row[0] === "synced_at" && column === "value"))))) return false;
      return normalize(cell) !== normalize(values[rowIndex + 1]?.[columnIndex]);
    }))) throw new Error(`Google values did not match: ${table.spec.sheet}.`);
  }
}

type WorkbookLayout = Record<string, { frozenRows: number; frozenColumns: number; filtered: boolean } | null>;
export function verifyWorkbookLayout(tables: readonly BuiltTable[], layout?: WorkbookLayout) {
  for (const table of tables) {
    const sheet = layout?.[table.spec.sheet];
    if (!sheet || sheet.frozenRows !== 1 || sheet.frozenColumns !== (table.spec.columns[0] === "id" ? 1 : 0) || sheet.filtered !== true) throw new Error(`Google table layout is incomplete: ${table.spec.sheet}.`);
  }
}

const GROUPS = [
  { name: "Start Here", entities: ["Tables", "SyncInfo"] },
  { name: "Competition", entities: ["Teams", "Matches", "MatchScouting", "PitScouting", "PickList", "RobotFailures", "Batteries"] },
  { name: "Team", entities: ["Members", "Hours", "Calendar", "Tasks"] },
  { name: "Build", entities: ["RobotFailures", "Batteries"] },
  { name: "Business", entities: ["Finance", "Sponsors"] },
] as const;
export function workspaceWorkbooks(team: HubTeam, source: WorkbookSource, now: Date) {
  const tables = buildAllTables(source, now, { shard: false });
  return GROUPS.map((group) => {
    // Shard after selecting a workspace, then describe its actual continuation table.
    // Each book is understandable without locating a catalog in another workbook.
    const data = shardWorkbookCells(tables.filter((table) => table.spec.entity !== "Tables" && table.spec.entity !== "SyncInfo" && (group.entities as readonly string[]).includes(table.spec.entity)));
    // Include the catalog in SyncInfo's shape before computing its cataloged row count.
    const sync = buildSyncInfoTable(source, [...data, buildCatalogTable([], now)], now);
    const catalog = buildCatalogTable([...data, sync], now);
    catalog.rows.push(["Tables", "Catalog of this workbook's tables, columns and stable keys.", "id", catalog.rows.length + 1, catalog.spec.columns.join(", "), now.toISOString(), "vantage"]);
    return {
      team: { ...team, key: group.name === "Competition" ? team.key : `${team.key}-${group.name.replaceAll(" ", "-")}`, rootKey: team.key, title: group.name },
      tables: [...data, catalog, buildSyncInfoTable(source, [...data, catalog], now)],
    };
  });
}
export async function provisionWorkbooks(bridge: AppsScriptBridge, team: HubTeam, source: WorkbookSource, options: {
  only?: WorkspaceWorkbookName;
  force?: boolean;
  now?: () => Date;
  /** Setup always verifies existing copies; routine sync only rechecks changed copies. */
  verifyUnchanged?: boolean;
  /** Only a matching, previously read-back-verified resource may skip verification. */
  verifiedResources?: Record<string, { id: string; hash: string }>;
  onVerified?: (name: string, resource: { id: string; schemaVersion: number; hash: string }, outcome: { book: HubTeamBook; changed: boolean; rowsWritten: number }) => Promise<void>;
} = {}) {
  const resources: Record<string, { id: string; schemaVersion: number; hash: string }> = {};
  const now = options.now ?? (() => new Date());
  for (const group of workspaceWorkbooks(team, source, now())) {
    if (options.only && group.team.title !== options.only) continue;
    const book = await bridge.ensureTeamBook(group.team);
    if (!book.id) throw new Error("Google did not register a workbook.");
    // Catalogs and SyncInfo are derived and excluded by contentHash. A layout
    // version change must still refresh them in already registered workbooks.
    const hash = createHash("sha256").update(JSON.stringify([WORKBOOK_SCHEMA_VERSION, source.orgName, source.teamNumber, source.activeEventKey])).update(contentHash(group.tables)).digest("hex");
    const changed = options.force === true || book.created || book.lastHash !== hash;
    if (changed) {
      // This target batches locally and flushes once. Preserve provider errors so a
      // daily quota wait reaches the durable step with its retry time intact.
      const target = new AppsScriptTarget(bridge, group.team);
      try {
        for (const table of group.tables) {
          await target.ensureTable(table.spec);
          await target.replaceRows(table.spec, table.rows);
        }
        await target.flush();
      } catch (error) {
        if (isGoogleSheetsError(error)) throw error;
        throw new Error("A Google table could not be written.", { cause: error });
      }
    }
    const registered = options.verifiedResources?.[group.team.title!];
    if (changed || options.verifyUnchanged !== false || registered?.id !== book.id || registered?.hash !== hash) {
      const read = await bridge.call<{ ok: boolean; values?: Record<string, unknown[][]> }>("read", { team: group.team, sheets: group.tables.map((table) => table.spec.sheet) });
      verifyWorkbookTables(group.tables, read.values, !changed);
      if (changed) await bridge.stampTeamBook(group.team, hash, group.tables.map((table) => table.spec.sheet));
      const inspect = () => bridge.call<{ ok: boolean; layout: WorkbookLayout }>("team.layout", { team: group.team, sheets: group.tables.map((table) => table.spec.sheet) });
      let layout = await inspect();
      if (!changed) {
        try { verifyWorkbookLayout(group.tables, layout.layout); }
        catch {
          await bridge.stampTeamBook(group.team, hash, group.tables.map((table) => table.spec.sheet));
          layout = await inspect();
        }
      }
      verifyWorkbookLayout(group.tables, layout.layout);
    }
    resources[group.team.title!] = { id: book.id, schemaVersion: WORKBOOK_SCHEMA_VERSION, hash };
    await options.onVerified?.(group.team.title!, resources[group.team.title!]!, {
      book: changed ? { ...book, lastHash: hash, lastSyncAt: now().toISOString() } : book,
      changed,
      rowsWritten: changed ? group.tables.reduce((count, table) => count + table.rows.length, 0) : 0,
    });
  }
  return resources;
}
