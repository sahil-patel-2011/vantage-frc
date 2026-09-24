/**
 * The logical-to-sheet mapping for the synced workbook: one worksheet and one Excel table
 * per entity. Pure — no I/O — so the layout is unit-tested and documented in one place
 * (docs/MICROSOFT_EXCEL.md mirrors this file).
 *
 * Rules every table follows:
 *  - `id` is a stable key from Postgres (a uuid, or a natural key such as a TBA match_key).
 *    Never a row number: rows are rewritten on every sync, so row positions mean nothing,
 *    and a future import-from-Excel must match rows by `id`.
 *  - `updated_at` is when Vantage last changed that record (ISO-8601 UTC).
 *  - `source` says where the record came from (scout entry method, TBA, a pick-list surface).
 *  - Scouting payload jsonb is flattened into `data.<key>` columns from the union of keys
 *    across all rows, in a stable sorted order, capped at MAX_PAYLOAD_COLUMNS; any keys past
 *    the cap are kept, as JSON, in one `data._more` column — nothing is silently dropped.
 */

export type CellValue = string | number | boolean | null;

export type WorkbookEntity =
  | "Teams"
  | "Matches"
  | "MatchScouting"
  | "PitScouting"
  | "PickList"
  // The team's own records (lib/microsoft/team-ops-tables) and the catalog of every table.
  | "Members"
  | "Hours"
  | "Calendar"
  | "Tasks"
  | "Finance"
  | "Sponsors"
  | "RobotFailures"
  | "Batteries"
  | "Tables"
  | "SyncInfo";

export type TableSpec = {
  entity: WorkbookEntity;
  /** Worksheet name. */
  sheet: string;
  /** Excel table name (structured references use it: =COUNTA(VantageTeams[id])). */
  table: string;
  columns: string[];
};

export type BuiltTable = { spec: TableSpec; rows: CellValue[][] };

/** Sheets are written in this order. SyncInfo last: it summarises the others. */
export const WORKBOOK_ENTITIES: WorkbookEntity[] = [
  "Teams",
  "Matches",
  "MatchScouting",
  "PitScouting",
  "PickList",
  "SyncInfo",
];

export const WORKBOOK_SCHEMA_VERSION = 1;
export const MAX_PAYLOAD_COLUMNS = 60;
export const MAX_ROWS_PER_TABLE = 20_000;
/** Excel's per-cell text limit is 32,767 characters. */
export const MAX_CELL_TEXT = 32_767;
export const PAYLOAD_PREFIX = "data.";
export const PAYLOAD_OVERFLOW_COLUMN = "data._more";

// ------------------------------------------------------------------ source rows (from Postgres)

export type TeamSourceRow = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  name: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  opr: number | null;
  dpr: number | null;
  ccwm: number | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  metricsSource: string | null;
  updatedAt: string | null;
};

export type MatchSourceRow = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  setNumber: number | null;
  matchNumber: number | null;
  red: string[];
  blue: string[];
  redScore: number | null;
  blueScore: number | null;
  winningAlliance: string | null;
  scheduledTime: string | null;
  actualTime: string | null;
  placeholder: boolean;
  updatedAt: string | null;
};

export type ScoutSourceRow = {
  id: string;
  eventKey: string;
  matchKey?: string | null;
  teamKey: string;
  scoutName: string | null;
  confidence: string | null;
  source: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  payload: unknown;
};

export type PickListSourceRow = {
  id: string;
  pickListId: string;
  listName: string;
  listStatus: string;
  listSource: string;
  eventKey: string;
  rank: number;
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  bucket: string;
  tier: string | null;
  notes: string | null;
  weightedScore: number;
  voteCount: number;
  draftedAllianceSeed: number | null;
  draftedPickSlot: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
};

export type WorkbookSource = {
  orgName: string;
  teamNumber: number | null;
  activeEventKey: string | null;
  teams: TeamSourceRow[];
  matches: MatchSourceRow[];
  matchScouting: ScoutSourceRow[];
  pitScouting: ScoutSourceRow[];
  pickList: PickListSourceRow[];
  /** The team's own records by table (lib/microsoft/team-ops-tables), when loaded. */
  ops?: Partial<Record<string, Record<string, unknown>[]>>;
};

// ------------------------------------------------------------------ cell hygiene

/**
 * Make a value safe to hand Excel as a cell value.
 *
 *  - null/undefined → "" (in a Graph range PATCH, `null` means "leave this cell alone",
 *    which would leave stale data behind — https://learn.microsoft.com/en-us/graph/api/range-update).
 *  - Text that Excel would treat as a formula (leading = + - @, or a tab/CR) gets a leading
 *    apostrophe, so a scout note like "=HYPERLINK(...)" stays text. Plain negative numbers
 *    written as text ("-3") are left alone.
 *  - Text is capped at Excel's 32,767-character cell limit.
 *  - Non-finite numbers become "".
 */
export function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text;
}

/** Code-unit order: identical on every machine and locale (localeCompare is not). */
export function stableCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/** The union of payload keys across rows, sorted, split at the column cap. */
export function payloadColumns(
  payloads: unknown[],
  cap = MAX_PAYLOAD_COLUMNS,
): { keys: string[]; overflowKeys: string[] } {
  const all = new Set<string>();
  for (const payload of payloads) for (const key of Object.keys(asRecord(payload))) all.add(key);
  const sorted = [...all].sort(stableCompare);
  return { keys: sorted.slice(0, cap), overflowKeys: sorted.slice(cap) };
}

/** One payload → cells for `keys`, plus the overflow JSON (sorted keys) when there is any. */
export function flattenPayload(payload: unknown, keys: string[], overflowKeys: string[]): CellValue[] {
  const record = asRecord(payload);
  const cells = keys.map((key) => toCell(record[key]));
  if (overflowKeys.length > 0) {
    const rest: Record<string, unknown> = {};
    for (const key of overflowKeys) if (key in record) rest[key] = record[key];
    cells.push(Object.keys(rest).length > 0 ? toCell(JSON.stringify(rest)) : "");
  }
  return cells;
}

export function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/i.exec(teamKey.trim());
  return match ? Number(match[1]) : null;
}

const COMP_LEVEL_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

// ------------------------------------------------------------------ builders

const TEAMS_COLUMNS = [
  "id", "team_number", "nickname", "name", "city", "state_prov", "country", "rookie_year",
  "epa_total", "epa_auto", "epa_teleop", "epa_endgame", "opr", "dpr", "ccwm",
  "rank", "wins", "losses", "ties", "event_key", "updated_at", "source",
];

const MATCHES_COLUMNS = [
  "id", "event_key", "comp_level", "set_number", "match_number",
  "red_1", "red_2", "red_3", "blue_1", "blue_2", "blue_3",
  "red_score", "blue_score", "winning_alliance", "scheduled_time", "actual_time", "updated_at", "source",
];

const MATCH_SCOUT_BASE = [
  "id", "event_key", "match_key", "team_key", "team_number", "scout", "confidence", "created_at", "updated_at", "source",
];

const PIT_SCOUT_BASE = [
  "id", "event_key", "team_key", "team_number", "scout", "confidence", "created_at", "updated_at", "source",
];

const PICKLIST_COLUMNS = [
  "id", "pick_list_id", "list_name", "list_status", "event_key", "rank", "team_key", "team_number", "nickname",
  "bucket", "tier", "notes", "weighted_score", "vote_count", "drafted_alliance_seed", "drafted_pick_slot",
  "updated_by", "updated_at", "source",
];

const SYNCINFO_COLUMNS = ["id", "value", "updated_at", "source"];

function spec(entity: WorkbookEntity, columns: string[]): TableSpec {
  return { entity, sheet: entity, table: `Vantage${entity}`, columns };
}

function cap<T>(rows: T[]): { rows: T[]; truncated: number } {
  return rows.length > MAX_ROWS_PER_TABLE
    ? { rows: rows.slice(0, MAX_ROWS_PER_TABLE), truncated: rows.length - MAX_ROWS_PER_TABLE }
    : { rows, truncated: 0 };
}

export function buildTeamsTable(source: WorkbookSource): BuiltTable {
  const sorted = [...source.teams].sort(
    (a, b) =>
      (a.teamNumber ?? teamNumberFromKey(a.teamKey) ?? Infinity) -
        (b.teamNumber ?? teamNumberFromKey(b.teamKey) ?? Infinity) || stableCompare(a.teamKey, b.teamKey),
  );
  const rows = cap(sorted).rows.map((t) =>
    [
      t.teamKey, t.teamNumber ?? teamNumberFromKey(t.teamKey), t.nickname, t.name, t.city, t.stateProv, t.country,
      t.rookieYear, t.epaTotal, t.epaAuto, t.epaTeleop, t.epaEndgame, t.opr, t.dpr, t.ccwm,
      t.rank, t.wins, t.losses, t.ties, source.activeEventKey, t.updatedAt,
      t.metricsSource ? `metrics:${t.metricsSource}` : "match_schedule",
    ].map(toCell),
  );
  return { spec: spec("Teams", TEAMS_COLUMNS), rows };
}

export function buildMatchesTable(source: WorkbookSource): BuiltTable {
  const sorted = [...source.matches].sort(
    (a, b) =>
      (COMP_LEVEL_ORDER[a.compLevel] ?? 9) - (COMP_LEVEL_ORDER[b.compLevel] ?? 9) ||
      (a.setNumber ?? 0) - (b.setNumber ?? 0) ||
      (a.matchNumber ?? 0) - (b.matchNumber ?? 0) ||
      stableCompare(a.matchKey, b.matchKey),
  );
  const rows = cap(sorted).rows.map((m) =>
    [
      m.matchKey, m.eventKey, m.compLevel, m.setNumber, m.matchNumber,
      m.red[0], m.red[1], m.red[2], m.blue[0], m.blue[1], m.blue[2],
      m.redScore, m.blueScore, m.winningAlliance, m.scheduledTime, m.actualTime, m.updatedAt,
      m.placeholder ? "scout_placeholder" : "tba",
    ].map(toCell),
  );
  return { spec: spec("Matches", MATCHES_COLUMNS), rows };
}

function scoutTable(
  entity: "MatchScouting" | "PitScouting",
  base: string[],
  entries: ScoutSourceRow[],
  baseCells: (row: ScoutSourceRow) => unknown[],
  order: (a: ScoutSourceRow, b: ScoutSourceRow) => number,
): BuiltTable {
  const sorted = cap([...entries].sort(order)).rows;
  const { keys, overflowKeys } = payloadColumns(sorted.map((row) => row.payload));
  const columns = [
    ...base,
    ...keys.map((key) => `${PAYLOAD_PREFIX}${key}`),
    ...(overflowKeys.length > 0 ? [PAYLOAD_OVERFLOW_COLUMN] : []),
  ];
  const rows = sorted.map((row) => [
    ...baseCells(row).map(toCell),
    ...flattenPayload(row.payload, keys, overflowKeys),
  ]);
  return { spec: spec(entity, dedupeColumns(columns)), rows };
}

/** Excel table headers must be unique; a payload key that collides gets a numeric suffix. */
export function dedupeColumns(columns: string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((column) => {
    // Excel caps a column header at 255 characters; leave room for a suffix.
    const name = (column.trim() || "column").slice(0, 240);
    const lower = name.toLowerCase();
    const count = seen.get(lower) ?? 0;
    seen.set(lower, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
}

export function buildMatchScoutingTable(source: WorkbookSource): BuiltTable {
  return scoutTable(
    "MatchScouting",
    MATCH_SCOUT_BASE,
    source.matchScouting,
    (r) => [r.id, r.eventKey, r.matchKey, r.teamKey, teamNumberFromKey(r.teamKey), r.scoutName, r.confidence, r.createdAt, r.updatedAt, r.source],
    (a, b) =>
      stableCompare(a.eventKey, b.eventKey) ||
      stableCompare(a.matchKey ?? "", b.matchKey ?? "") ||
      stableCompare(a.teamKey, b.teamKey) ||
      stableCompare(a.createdAt ?? "", b.createdAt ?? "") ||
      stableCompare(a.id, b.id),
  );
}

export function buildPitScoutingTable(source: WorkbookSource): BuiltTable {
  return scoutTable(
    "PitScouting",
    PIT_SCOUT_BASE,
    source.pitScouting,
    (r) => [r.id, r.eventKey, r.teamKey, teamNumberFromKey(r.teamKey), r.scoutName, r.confidence, r.createdAt, r.updatedAt, r.source],
    (a, b) =>
      stableCompare(a.eventKey, b.eventKey) ||
      (teamNumberFromKey(a.teamKey) ?? Infinity) - (teamNumberFromKey(b.teamKey) ?? Infinity) ||
      stableCompare(a.createdAt ?? "", b.createdAt ?? "") ||
      stableCompare(a.id, b.id),
  );
}

export function buildPickListTable(source: WorkbookSource): BuiltTable {
  const sorted = [...source.pickList].sort((a, b) => a.rank - b.rank || stableCompare(a.id, b.id));
  const rows = cap(sorted).rows.map((p) =>
    [
      p.id, p.pickListId, p.listName, p.listStatus, p.eventKey, p.rank, p.teamKey, p.teamNumber ?? teamNumberFromKey(p.teamKey),
      p.nickname, p.bucket, p.tier, p.notes, p.weightedScore, p.voteCount, p.draftedAllianceSeed, p.draftedPickSlot,
      p.updatedByName, p.updatedAt, p.listSource,
    ].map(toCell),
  );
  return { spec: spec("PickList", PICKLIST_COLUMNS), rows };
}

export function buildSyncInfoTable(source: WorkbookSource, others: BuiltTable[], now: Date): BuiltTable {
  const at = now.toISOString();
  const truncated = (
    [
      ["Teams", source.teams.length],
      ["Matches", source.matches.length],
      ["MatchScouting", source.matchScouting.length],
      ["PitScouting", source.pitScouting.length],
      ["PickList", source.pickList.length],
    ] as Array<[string, number]>
  ).filter(([, count]) => count > MAX_ROWS_PER_TABLE);
  const entries: Array<[string, CellValue]> = [
    ["about", "A copy of this team's Vantage data. Vantage rewrites the Vantage* tables on every sync — keep your own formulas and notes on other sheets."],
    ["team_number", source.teamNumber],
    ["team_name", source.orgName],
    ["active_event_key", source.activeEventKey ?? "(none set in Vantage)"],
    ["synced_at", at],
    ["schema_version", WORKBOOK_SCHEMA_VERSION],
    ...others.map((table): [string, CellValue] => [`rows.${table.spec.entity}`, table.rows.length]),
    ["rows.truncated", truncated.length ? truncated.map(([name, count]) => `${name}: ${count}`).join("; ") : "none"],
  ];
  return {
    spec: spec("SyncInfo", SYNCINFO_COLUMNS),
    rows: entries.map(([key, value]) => [toCell(key), toCell(value), at, "vantage"]),
  };
}

/** Every table, in write order. Deterministic for a given source and clock. */
export function buildWorkbookTables(source: WorkbookSource, now: Date): BuiltTable[] {
  const data = [
    buildTeamsTable(source),
    buildMatchesTable(source),
    buildMatchScoutingTable(source),
    buildPitScoutingTable(source),
    buildPickListTable(source),
  ];
  return [...data, buildSyncInfoTable(source, data, now)];
}

/** Spreadsheet column letters: 1 → A, 26 → Z, 27 → AA. */
export function columnLetter(index1: number): string {
  let n = index1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
