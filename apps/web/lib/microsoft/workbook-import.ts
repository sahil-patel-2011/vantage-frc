/**
 * Import changes from Excel back into Vantage: the pure half.
 *
 * Takes what the workbook's Vantage* tables say now (header row + cell values, as Graph
 * returns them) and what Postgres says now, and produces a preview: which human-owned
 * fields changed, which rows cannot be matched, which edits land in read-only columns,
 * which rows were deleted in Excel, and which rows are CONFLICTS because Vantage changed
 * them after the workbook was written. No I/O; run-import.ts does the reading and writing.
 *
 * The rules (docs/MICROSOFT_EXCEL.md, "Importing changes from Excel"):
 *
 *  - Rows are matched on `id`, never on position. A row without an id is ignored and
 *    counted; an id that appears twice is ambiguous, so neither copy is imported.
 *  - Allow-list only. PickList: `rank`, `bucket`, `notes`. MatchScouting / PitScouting:
 *    `confidence` and the `data.<field>` columns. Everything else — keys, event/team,
 *    timestamps, `source`, TBA/Statbotics-derived numbers, `data._more` — is read-only:
 *    edits there are reported and never applied.
 *  - No inserts and no deletes. A row Vantage has but the workbook does not is reported.
 *  - Optimistic concurrency. A row's `updated_at` cell is the version it was exported at.
 *    If Postgres's updated_at differs, every edit on that row is a conflict and nothing on
 *    it is applied — Vantage never overwrites a change it has not shown the coach.
 *  - Cell hygiene is reversed exactly: the export prefixes formula-like text with an
 *    apostrophe (workbook-schema.ts `toCell`); `unescapeCell` strips it under the same
 *    condition and no other. Comparison is tolerant of what Excel does to values on the
 *    way in (a "3" typed as text comes back as the number 3; TRUE comes back boolean).
 */

import { createHash } from "node:crypto";
import { isPickBucket } from "../picklist/ordering";
import type { PickBucket } from "../picklist/types";
import {
  type CellValue,
  PAYLOAD_OVERFLOW_COLUMN,
  PAYLOAD_PREFIX,
  type PickListSourceRow,
  type ScoutSourceRow,
  type WorkbookSource,
  buildMatchScoutingTable,
  buildPickListTable,
  buildPitScoutingTable,
  payloadColumns,
  teamNumberFromKey,
  toCell,
} from "./workbook-schema";

// ------------------------------------------------------------------ inputs

export type ImportEntity = "PickList" | "MatchScouting" | "PitScouting";
type ScoutEntity = Exclude<ImportEntity, "PickList">;

export type WorkbookTableRef = { entity: ImportEntity; sheet: string; table: string };

/** The tables an import reads, in preview order. */
export const IMPORT_TABLES: readonly WorkbookTableRef[] = [
  { entity: "PickList", sheet: "PickList", table: "VantagePickList" },
  { entity: "MatchScouting", sheet: "MatchScouting", table: "VantageMatchScouting" },
  { entity: "PitScouting", sheet: "PitScouting", table: "VantagePitScouting" },
];

/** What a table looks like in the workbook right now: header names and raw cell values. */
export type WorkbookTableRead = { headers: unknown[]; rows: unknown[][]; truncated?: boolean };

export interface WorkbookReader {
  /** null when the workbook has no table by that name. */
  readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null>;
  /** Release anything held open. Must not throw. */
  close(): Promise<void>;
}

/** Row versions: `version` is Postgres's exact updated_at text, used by the guarded UPDATE. */
export type PickImportRow = PickListSourceRow & { version: string; inScope: boolean };
export type ScoutImportRow = ScoutSourceRow & { schemaId: string | null; version: string; inScope: boolean };

export type ImportSource = {
  activeEventKey: string | null;
  /** The pick list the workbook's rows belong to (null when the team has none). */
  pickList: { id: string; name: string; status: string } | null;
  pickEntries: PickImportRow[];
  matchScouting: ScoutImportRow[];
  pitScouting: ScoutImportRow[];
};

/**
 * Server-side check of one scouting value against the entry's own form (schema): may
 * coerce ("12" → 12 for a number question) or refuse with a plain-language reason.
 */
export type ScoutFieldCheck = (input: {
  entity: ScoutEntity;
  schemaId: string | null;
  key: string;
  value: unknown;
}) => { ok: true; value: unknown } | { ok: false; reason: string };

export type DiffOptions = { checkScoutField?: ScoutFieldCheck };

// ------------------------------------------------------------------ outputs

export type ImportChange = {
  /** Stable fingerprint of (row, field, old, new, version): apply re-derives it and only
   *  writes changes whose fingerprint the user confirmed. */
  id: string;
  entity: ImportEntity;
  rowId: string;
  label: string;
  field: string;
  /** For `data.<field>` columns: the key inside the scouting payload the column maps to. */
  payloadKey?: string;
  from: CellValue;
  to: CellValue;
  /** The value that will be written (typed: number, boolean, string or null). */
  value: unknown;
  /** Postgres's updated_at text for the row when the preview was built. */
  version: string;
};

export type ImportConflict = {
  entity: ImportEntity;
  rowId: string;
  label: string;
  fields: string[];
  workbookUpdatedAt: string | null;
  vantageUpdatedAt: string | null;
};

export type ImportNote = {
  entity: ImportEntity;
  rowId: string;
  label: string;
  field: string;
  from: CellValue;
  to: CellValue;
  reason: string;
};

export type ImportTablePreview = {
  entity: ImportEntity;
  found: boolean;
  rowsRead: number;
  changes: ImportChange[];
  conflicts: ImportConflict[];
  readOnlyEdits: ImportNote[];
  invalid: ImportNote[];
  unmatched: Array<{ rowId: string }>;
  notInWorkbook: Array<{ rowId: string; label: string }>;
  withoutId: number;
  duplicateIds: string[];
  unknownColumns: string[];
  missingColumns: string[];
  notice: string | null;
};

export type ImportTotals = {
  changes: number;
  conflicts: number;
  readOnlyEdits: number;
  invalid: number;
  unmatched: number;
  notInWorkbook: number;
  withoutId: number;
  duplicateIds: number;
};

export type ImportPreview = { tables: ImportTablePreview[]; totals: ImportTotals };

// ------------------------------------------------------------------ cell semantics

const RISKY_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NUMERIC_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const EXCEL_ERROR = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!|GETTING_DATA)$/;

/**
 * The exact inverse of toCell's formula guard: strip the leading apostrophe only when the
 * rest is text toCell would have guarded. "'=HYPERLINK(x)" → "=HYPERLINK(x)";
 * "'hello" and "'-3" stay as they are, because toCell never adds an apostrophe to those.
 */
export function unescapeCell(text: string): string {
  if (text.startsWith("'")) {
    const rest = text.slice(1);
    if (RISKY_START.test(rest) && !PLAIN_NUMBER.test(rest)) return rest;
  }
  return text;
}

type Canon = { k: "blank" } | { k: "num"; n: number } | { k: "bool"; b: boolean } | { k: "text"; s: string };

function canon(value: unknown): Canon {
  if (value === null || value === undefined) return { k: "blank" };
  if (typeof value === "number") return Number.isFinite(value) ? { k: "num", n: value } : { k: "blank" };
  if (typeof value === "boolean") return { k: "bool", b: value };
  const text = unescapeCell(String(value)).replace(/\r\n?/g, "\n");
  if (text === "") return { k: "blank" };
  const trimmed = text.trim();
  if (NUMERIC_TEXT.test(trimmed)) return { k: "num", n: Number(trimmed) };
  if (/^(true|false)$/i.test(trimmed)) return { k: "bool", b: trimmed.toLowerCase() === "true" };
  return { k: "text", s: text };
}

/**
 * Does the workbook cell still hold what Vantage exported? Tolerant of Excel's typing:
 * "3" ≡ 3, "TRUE" ≡ true, "" ≡ null, an apostrophe-guarded formula ≡ the same text
 * without the apostrophe, and float noise in the 10th significant digit.
 */
export function sameCell(exported: unknown, read: unknown): boolean {
  const a = canon(exported);
  const b = canon(read);
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "blank":
      return true;
    case "num": {
      const other = (b as { n: number }).n;
      return Math.abs(a.n - other) <= 1e-9 * Math.max(1, Math.abs(a.n), Math.abs(other));
    }
    case "bool":
      return a.b === (b as { b: boolean }).b;
    case "text":
      return a.s === (b as { s: string }).s;
  }
}

/** Excel stores dates as serial days since 1899-12-30. */
const EXCEL_EPOCH_DAYS = 25569;

/**
 * An `updated_at` / `created_at` cell → ISO-8601 UTC at second precision (the format the
 * export writes), or null when it is blank or unreadable. Accepts the ISO text Vantage
 * wrote, the same text with the apostrophe stripped or a space for the T, and an Excel date
 * serial (if Excel turned the text into a date).
 */
export function normalizeWorkbookTimestamp(value: unknown): string | null {
  let ms: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    ms = Math.round((value - EXCEL_EPOCH_DAYS) * 86_400) * 1000;
  } else if (typeof value === "string") {
    let text = unescapeCell(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) text = `${text.replace(" ", "T")}Z`;
    ms = Date.parse(text);
  } else {
    return null;
  }
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A cell as the preview shows it: unescaped text, capped for display. */
function display(value: unknown): CellValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value;
  const text = typeof value === "string" ? unescapeCell(value) : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function isBlank(value: unknown): boolean {
  return canon(value).k === "blank";
}

type Decoded = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * Read a changed cell as the type the stored value already has. Blank → null. Nested
 * values (objects/arrays written as JSON text) are not decoded: they are read-only.
 */
export function decodeCellAs(read: unknown, original: unknown): Decoded {
  if (typeof read === "string" && EXCEL_ERROR.test(read.trim())) {
    return { ok: false, reason: `Excel shows an error (${read.trim()}) in this cell.` };
  }
  if (isBlank(read)) return { ok: true, value: null };
  const c = canon(read);
  const text = typeof read === "string" ? unescapeCell(read) : String(read);

  if (typeof original === "number") {
    if (c.k === "num") return { ok: true, value: c.n };
    return { ok: false, reason: "This needs a number." };
  }
  if (typeof original === "boolean") {
    if (c.k === "bool") return { ok: true, value: c.b };
    return { ok: false, reason: "This needs TRUE or FALSE." };
  }
  if (typeof original === "string") {
    if (typeof read === "boolean") return { ok: true, value: read ? "true" : "false" };
    return { ok: true, value: text };
  }
  // No stored value yet: keep the type Excel reports.
  if (typeof read === "number") return { ok: true, value: read };
  if (typeof read === "boolean") return { ok: true, value: read };
  return { ok: true, value: text };
}

const BUCKET_ALIASES: Record<string, PickBucket> = {
  first: "first_pick",
  first_pick: "first_pick",
  second: "second_pick",
  second_pick: "second_pick",
  unranked: "unranked",
  avoid: "avoid",
  do_not_pick: "avoid",
};

/** "First pick", "first_pick", "FIRST-PICK" → first_pick. */
export function parseBucket(value: unknown): PickBucket | null {
  if (typeof value !== "string") return null;
  const key = unescapeCell(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const bucket = BUCKET_ALIASES[key] ?? null;
  return bucket && isPickBucket(bucket) ? bucket : null;
}

export const PICK_NOTES_MAX = 2000;
const CONFIDENCE = new Set(["high", "normal", "low"]);

// ------------------------------------------------------------------ labels

function teamLabel(teamKey: string, teamNumber?: number | null): string {
  const number = teamNumber ?? teamNumberFromKey(teamKey);
  return number ? `Team ${number}` : teamKey;
}

function matchLabel(matchKey: string | null | undefined, eventKey: string): string {
  if (!matchKey) return "Match";
  return matchKey.startsWith(`${eventKey}_`) ? matchKey.slice(eventKey.length + 1) : matchKey;
}

function pickLabel(row: PickImportRow): string {
  return `${teamLabel(row.teamKey, row.teamNumber)}${row.nickname ? ` (${row.nickname})` : ""}`;
}

function scoutLabel(entity: ScoutEntity, row: ScoutImportRow): string {
  const who = row.scoutName ? ` · ${row.scoutName}` : "";
  return entity === "MatchScouting"
    ? `${matchLabel(row.matchKey, row.eventKey)} · ${teamLabel(row.teamKey)}${who}`
    : `Pit · ${teamLabel(row.teamKey)}${who}`;
}

// ------------------------------------------------------------------ the diff

function changeId(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

type Column =
  | { kind: "id" }
  | { kind: "updated_at" }
  | { kind: "timestamp"; header: string }
  | { kind: "readonly"; header: string; why: string }
  | { kind: "allowed"; header: string }
  | { kind: "payload"; header: string; key: string }
  | { kind: "unknown"; header: string };

type Current<Row> = {
  raw: Row;
  updatedAt: string | null;
  version: string;
  label: string;
  /** Base (non-payload) cells exactly as the export renders them now. */
  cells: Map<string, CellValue>;
};

type TableRules<Row> = {
  entity: ImportEntity;
  /** Header names the export writes for this table, now. */
  columns: string[];
  current: Map<string, Current<Row>>;
  inScope: (row: Row) => boolean;
  allowed: Set<string>;
  payloadKeys: Map<string, string> | null;
  payloadOf: ((row: Row) => Record<string, unknown>) | null;
  decode: (row: Current<Row>, field: string, read: unknown) => Decoded;
  payloadCheck?: (row: Row, key: string, value: unknown) => Decoded;
  blocked: string | null;
};

function emptyTable(entity: ImportEntity, notice: string | null): ImportTablePreview {
  return {
    entity,
    found: false,
    rowsRead: 0,
    changes: [],
    conflicts: [],
    readOnlyEdits: [],
    invalid: [],
    unmatched: [],
    notInWorkbook: [],
    withoutId: 0,
    duplicateIds: [],
    unknownColumns: [],
    missingColumns: [],
    notice,
  };
}

function idText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return unescapeCell(String(value)).trim();
}

/** The distinct non-blank values of one column (e.g. every `id`), so the loader can fetch those rows. */
export function workbookColumnValues(read: WorkbookTableRead | null | undefined, header: string): string[] {
  if (!read) return [];
  const index = read.headers.findIndex((name) => idText(name) === header);
  if (index < 0) return [];
  const values = new Set<string>();
  for (const row of read.rows) {
    const value = Array.isArray(row) ? idText(row[index]) : "";
    if (value) values.add(value);
  }
  return [...values];
}

function renderedCells(columns: string[], rows: CellValue[][]): Map<string, Map<string, CellValue>> {
  const out = new Map<string, Map<string, CellValue>>();
  for (const row of rows) {
    const cells = new Map<string, CellValue>();
    columns.forEach((column, index) => {
      if (!column.startsWith(PAYLOAD_PREFIX) || column === PAYLOAD_OVERFLOW_COLUMN) cells.set(column, row[index] ?? "");
    });
    out.set(String(row[0] ?? ""), cells);
  }
  return out;
}

function classify<Row>(header: string, rules: TableRules<Row>): Column {
  if (header === "id") return { kind: "id" };
  if (header === "updated_at") return { kind: "updated_at" };
  if (header === "created_at") return { kind: "timestamp", header };
  if (rules.allowed.has(header)) return { kind: "allowed", header };
  if (header === PAYLOAD_OVERFLOW_COLUMN) {
    return { kind: "readonly", header, why: "Fields past the 60-column limit are kept here as JSON. Edit them in Vantage." };
  }
  if (rules.payloadKeys && header.startsWith(PAYLOAD_PREFIX)) {
    const key = rules.payloadKeys.get(header);
    if (key !== undefined) return { kind: "payload", header, key };
    return { kind: "unknown", header };
  }
  if (rules.columns.includes(header)) return { kind: "readonly", header, why: "Vantage owns this column." };
  return { kind: "unknown", header };
}

function diffTable<Row>(read: WorkbookTableRead | null, rules: TableRules<Row>, tableName: string): ImportTablePreview {
  if (!read) {
    return emptyTable(rules.entity, `The workbook has no ${tableName} table yet. Press Sync now first.`);
  }
  const table = emptyTable(rules.entity, null);
  table.found = true;
  const headers = read.headers.map((header) => idText(header));
  table.missingColumns = rules.columns.filter(
    (column) => !column.startsWith(PAYLOAD_PREFIX) && !headers.includes(column),
  );
  const idIndex = headers.indexOf("id");
  const updatedIndex = headers.indexOf("updated_at");
  if (idIndex < 0 || updatedIndex < 0) {
    table.notice = "This table is missing its id or updated_at column, so Vantage cannot tell which rows are which. Press Sync now to rebuild it.";
    return table;
  }
  if (read.truncated) table.notice = "This table is very long; only its first rows were read.";
  if (rules.blocked) table.notice = rules.blocked;

  const columns = headers.map((header) => classify(header, rules));
  table.unknownColumns = [...new Set(columns.flatMap((column) => (column.kind === "unknown" ? [column.header || "(blank header)"] : [])))];

  // First pass: ids, blanks, duplicates.
  const byId = new Map<string, unknown[][]>();
  for (const row of read.rows) {
    if (!Array.isArray(row) || row.every(isBlank)) continue; // Vantage's placeholder row, or an empty line
    table.rowsRead += 1;
    const id = idText(row[idIndex]);
    if (!id) {
      table.withoutId += 1;
      continue;
    }
    const list = byId.get(id) ?? [];
    list.push(row);
    byId.set(id, list);
  }

  for (const [id, rows] of byId) {
    if (rows.length > 1) {
      table.duplicateIds.push(id.slice(0, 100));
      continue;
    }
    const row = rows[0]!;
    const current = rules.current.get(id);
    if (!current) {
      table.unmatched.push({ rowId: id.slice(0, 100) });
      continue;
    }

    const candidates: Array<Omit<ImportChange, "id" | "version">> = [];
    const invalid: ImportNote[] = [];
    const readOnly: ImportNote[] = [];
    const note = (field: string, from: unknown, to: unknown, reason: string): ImportNote => ({
      entity: rules.entity,
      rowId: id,
      label: current.label,
      field,
      from: display(from),
      to: display(to),
      reason,
    });

    columns.forEach((column, index) => {
      if (column.kind === "id" || column.kind === "updated_at" || column.kind === "unknown") return;
      const cell = row[index];
      if (column.kind === "timestamp") {
        const exported = current.cells.get(column.header) ?? "";
        if (normalizeWorkbookTimestamp(exported) !== normalizeWorkbookTimestamp(cell) && !sameCell(exported, cell)) {
          readOnly.push(note(column.header, exported, cell, "Vantage owns this column."));
        }
        return;
      }
      if (column.kind === "payload") {
        const payload = rules.payloadOf!(current.raw);
        const original = payload[column.key];
        const exported = toCell(original);
        if (sameCell(exported, cell)) return;
        if (original !== null && typeof original === "object") {
          readOnly.push(note(column.header, exported, cell, "This answer has several parts. Edit it in Vantage."));
          return;
        }
        let decoded = decodeCellAs(cell, original);
        if (decoded.ok && rules.payloadCheck) decoded = rules.payloadCheck(current.raw, column.key, decoded.value);
        if (!decoded.ok) {
          invalid.push(note(column.header, exported, cell, decoded.reason));
          return;
        }
        // The form may have normalised the value back to what is stored ("12" → 12).
        if (sameCell(exported, toCell(decoded.value))) return;
        candidates.push({
          entity: rules.entity,
          rowId: id,
          label: current.label,
          field: column.header,
          payloadKey: column.key,
          from: display(exported),
          to: display(decoded.value),
          value: decoded.value,
        });
        return;
      }
      const exported = current.cells.get(column.header) ?? "";
      if (sameCell(exported, cell)) return;
      if (column.kind === "readonly") {
        readOnly.push(note(column.header, exported, cell, column.why));
        return;
      }
      const decoded = rules.decode(current, column.header, cell);
      if (!decoded.ok) {
        invalid.push(note(column.header, exported, cell, decoded.reason));
        return;
      }
      candidates.push({
        entity: rules.entity,
        rowId: id,
        label: current.label,
        field: column.header,
        from: display(exported),
        to: display(decoded.value),
        value: decoded.value,
      });
    });

    const workbookUpdatedAt = normalizeWorkbookTimestamp(row[updatedIndex]);
    const edited = candidates.length + invalid.length > 0;
    if (edited && (!workbookUpdatedAt || workbookUpdatedAt !== current.updatedAt)) {
      table.conflicts.push({
        entity: rules.entity,
        rowId: id,
        label: current.label,
        fields: [...candidates.map((c) => c.field), ...invalid.map((c) => c.field)],
        workbookUpdatedAt,
        vantageUpdatedAt: current.updatedAt,
      });
      continue;
    }
    // A stale row with no human edits is just an old copy; its read-only cells differ because
    // Vantage moved on, not because someone typed there. Only report them on current rows.
    if (workbookUpdatedAt === current.updatedAt) table.readOnlyEdits.push(...readOnly);
    if (rules.blocked) {
      table.invalid.push(...invalid, ...candidates.map((c) => note(c.field, c.from, c.to, rules.blocked!)));
      continue;
    }
    table.invalid.push(...invalid);
    for (const candidate of candidates) {
      table.changes.push({
        ...candidate,
        id: changeId([rules.entity, id, candidate.field, candidate.from, candidate.value, current.version]),
        version: current.version,
      });
    }
  }

  for (const [id, current] of rules.current) {
    if (rules.inScope(current.raw) && !byId.has(id)) table.notInWorkbook.push({ rowId: id, label: current.label });
  }
  return table;
}

// ------------------------------------------------------------------ per-table rules

function sourceWith(partial: Partial<WorkbookSource>): WorkbookSource {
  return {
    orgName: "",
    teamNumber: null,
    activeEventKey: null,
    teams: [],
    matches: [],
    matchScouting: [],
    pitScouting: [],
    pickList: [],
    ...partial,
  };
}

function pickListRules(source: ImportSource): TableRules<PickImportRow> {
  const built = buildPickListTable(sourceWith({ activeEventKey: source.activeEventKey, pickList: source.pickEntries }));
  const cells = renderedCells(built.spec.columns, built.rows);
  const current = new Map<string, Current<PickImportRow>>();
  for (const row of source.pickEntries) {
    current.set(row.id, {
      raw: row,
      updatedAt: normalizeWorkbookTimestamp(row.updatedAt),
      version: row.version,
      label: pickLabel(row),
      cells: cells.get(row.id) ?? new Map(),
    });
  }
  const status = source.pickList?.status;
  return {
    entity: "PickList",
    columns: built.spec.columns,
    current,
    inScope: (row) => row.inScope,
    allowed: new Set(["rank", "bucket", "notes"]),
    payloadKeys: null,
    payloadOf: null,
    blocked: status && status !== "open" ? `This pick list is ${status} in Vantage. Reopen it there to import changes.` : null,
    decode(_row, field, read) {
      if (typeof read === "string" && EXCEL_ERROR.test(read.trim())) {
        return { ok: false, reason: `Excel shows an error (${read.trim()}) in this cell.` };
      }
      if (field === "rank") {
        const c = canon(read);
        if (c.k !== "num" || !Number.isInteger(c.n) || c.n < 1 || c.n > 9999) {
          return { ok: false, reason: "Rank needs a whole number, 1 or more." };
        }
        return { ok: true, value: c.n };
      }
      if (field === "bucket") {
        const bucket = parseBucket(read);
        return bucket
          ? { ok: true, value: bucket }
          : { ok: false, reason: "Bucket must be first_pick, second_pick, unranked or avoid." };
      }
      // notes
      if (isBlank(read)) return { ok: true, value: null };
      const text = (typeof read === "string" ? unescapeCell(read) : String(read)).trim();
      if (!text) return { ok: true, value: null };
      if (text.length > PICK_NOTES_MAX) return { ok: false, reason: `Notes are limited to ${PICK_NOTES_MAX.toLocaleString("en-US")} characters.` };
      return { ok: true, value: text };
    },
  };
}

function scoutRules(entity: ScoutEntity, rows: ScoutImportRow[], options: DiffOptions): TableRules<ScoutImportRow> {
  const built =
    entity === "MatchScouting"
      ? buildMatchScoutingTable(sourceWith({ matchScouting: rows }))
      : buildPitScoutingTable(sourceWith({ pitScouting: rows }));
  const cells = renderedCells(built.spec.columns, built.rows);

  // header → payload key, exactly as the export named the columns (dedupe suffixes
  // included), plus the plain `data.<key>` spelling for any key Vantage knows.
  const { keys, overflowKeys } = payloadColumns(rows.map((row) => row.payload));
  const payloadKeys = new Map<string, string>();
  const base = built.spec.columns.length - keys.length - (overflowKeys.length > 0 ? 1 : 0);
  keys.forEach((key, index) => payloadKeys.set(built.spec.columns[base + index]!, key));
  for (const key of [...keys, ...overflowKeys]) {
    const header = `${PAYLOAD_PREFIX}${key}`;
    if (!payloadKeys.has(header)) payloadKeys.set(header, key);
  }
  payloadKeys.delete(PAYLOAD_OVERFLOW_COLUMN);

  const current = new Map<string, Current<ScoutImportRow>>();
  for (const row of rows) {
    current.set(row.id, {
      raw: row,
      updatedAt: normalizeWorkbookTimestamp(row.updatedAt),
      version: row.version,
      label: scoutLabel(entity, row),
      cells: cells.get(row.id) ?? new Map(),
    });
  }
  const payloadOf = (row: ScoutImportRow) =>
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};

  const check = options.checkScoutField;
  return {
    entity,
    columns: built.spec.columns,
    current,
    inScope: (row) => row.inScope,
    allowed: new Set(["confidence"]),
    payloadKeys,
    payloadOf,
    blocked: null,
    decode(_row, _field, read) {
      const text = typeof read === "string" ? unescapeCell(read).trim().toLowerCase() : "";
      return CONFIDENCE.has(text) ? { ok: true, value: text } : { ok: false, reason: "Confidence must be high, normal or low." };
    },
    // Scouting answers also pass the entry's own form rules, when the caller supplies them.
    payloadCheck: check ? (row, key, value) => check({ entity, schemaId: row.schemaId, key, value }) : undefined,
  };
}

// ------------------------------------------------------------------ entry point

export function diffWorkbook(
  reads: Partial<Record<ImportEntity, WorkbookTableRead | null>>,
  source: ImportSource,
  options: DiffOptions = {},
): ImportPreview {
  const tables = [
    diffTable(reads.PickList ?? null, pickListRules(source), "VantagePickList"),
    diffTable(reads.MatchScouting ?? null, scoutRules("MatchScouting", source.matchScouting, options), "VantageMatchScouting"),
    diffTable(reads.PitScouting ?? null, scoutRules("PitScouting", source.pitScouting, options), "VantagePitScouting"),
  ];
  const sum = (pick: (table: ImportTablePreview) => number) => tables.reduce((total, table) => total + pick(table), 0);
  return {
    tables,
    totals: {
      changes: sum((t) => t.changes.length),
      conflicts: sum((t) => t.conflicts.length),
      readOnlyEdits: sum((t) => t.readOnlyEdits.length),
      invalid: sum((t) => t.invalid.length),
      unmatched: sum((t) => t.unmatched.length),
      notInWorkbook: sum((t) => t.notInWorkbook.length),
      withoutId: sum((t) => t.withoutId),
      duplicateIds: sum((t) => t.duplicateIds.length),
    },
  };
}
