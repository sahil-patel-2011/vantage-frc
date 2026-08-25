/**
 * Scoutradioz raw export — https://github.com/FIRSTTeam102/scoutradioz
 *
 * Verified against the repo's own sources:
 *  - `scoutradioz-types/types.d.ts` declares the `matchscouting` document as
 *    `{ year, event_key, org_key, match_key, match_number, time, alliance,
 *       team_key, match_team_key, actual_scorer?, data?, super_data?, ... }`
 *    and the `pitscouting` document as
 *    `{ year, event_key, org_key, team_key, actual_scouter?, data?, ... }`.
 *    A document with no `data` was never scouted — Scoutradioz's own export
 *    query filters on `data: {$exists: true}`, and so do we.
 *  - `scoutradioz-helpers/src/jsonlayout.ts` lists the eleven layout element
 *    types: checkbox, counter, slider, multiselect, textblock, header,
 *    subheader, spacer, derived, image, importdata. Of those, header /
 *    subheader / textblock / spacer / image carry no answer, and `derived` is
 *    a formula Scoutradioz recomputes — none of them are imported as answers.
 *
 * `match_team_key` (`<match_key>_<team_key>`) is Scoutradioz's own per-row
 * identity, so it is the idempotency key: re-importing the same export writes
 * nothing new.
 */

import { parseCsvRows } from "./csv-rows";
import {
  provenanceNow,
  type ScoutEntryDraft,
} from "./provenance";
import {
  emptyResult,
  isRecord,
  parseJsonOrReject,
  rejectShape,
  type ImportResult,
} from "./result";

/** Layout element types that hold no scouted answer, and why we drop them. */
export const SCOUTRADIOZ_NON_ANSWER_LAYOUT: Record<string, string> = {
  header: "a Scoutradioz \"header\" is a layout heading, not a question",
  subheader: "a Scoutradioz \"subheader\" is a layout heading, not a question",
  textblock: "a Scoutradioz \"textblock\" is static instruction text, not a question",
  spacer: "a Scoutradioz \"spacer\" is layout whitespace, not a question",
  image: "a Scoutradioz \"image\" is a layout illustration, not a question",
  derived:
    "a Scoutradioz \"derived\" metric is a formula recomputed from other fields — importing it would store a number no scout ever entered",
  importdata: "a Scoutradioz \"importdata\" element pulls values from another source rather than from a scout",
};

export type ScoutradiozLayoutItem = { type?: string; id?: string; label?: string };

export type ScoutradiozDocument = {
  year?: number;
  event_key?: string;
  org_key?: string;
  match_key?: string;
  match_number?: number;
  alliance?: string;
  team_key?: string;
  match_team_key?: string;
  data?: Record<string, unknown>;
  super_data?: Record<string, unknown>;
};

const EXPECTED =
  "a Scoutradioz raw export: an array of matchscouting or pitscouting documents " +
  "(or { data: [ ... ] } / { matchscouting: [ ... ] }), each with event_key, team_key, and a data object — " +
  "or the CSV that /reports/exportdata emits, with a team_key column.";

function looksLikeDocument(value: unknown): value is ScoutradiozDocument {
  if (!isRecord(value)) return false;
  return "team_key" in value && ("event_key" in value || "match_key" in value);
}

/**
 * Identity columns Scoutradioz's CSV export declares in its header. Everything
 * else in a row is a scouted answer and passes through into `data` under its
 * own literal header — nothing is renamed or guessed.
 */
const CSV_IDENTITY_COLUMNS = new Set([
  "year",
  "event_key",
  "org_key",
  "match_key",
  "match_number",
  "alliance",
  "team_key",
  "match_team_key",
]);

/** Scoutradioz's live /reports/exportdata route emits CSV, not JSON. */
function documentsFromCsv(content: string): ScoutradiozDocument[] {
  const rows = parseCsvRows(content);
  const headers = rows.length ? Object.keys(rows[0]!) : [];
  if (!rows.length || !headers.includes("team_key")) {
    const found = headers.length
      ? `That CSV has columns ${headers.slice(0, 12).join(", ")}.`
      : "That text is neither JSON nor a CSV with a header row and data rows.";
    rejectShape(found, EXPECTED);
  }
  return rows.map((row) => {
    const document: ScoutradiozDocument = {};
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!CSV_IDENTITY_COLUMNS.has(key)) {
        data[key] = value;
        continue;
      }
      if (value === "") continue;
      if (key === "year" || key === "match_number") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) document[key] = numeric;
        continue;
      }
      document[key as "event_key" | "org_key" | "match_key" | "alliance" | "team_key" | "match_team_key"] =
        value;
    }
    document.data = data;
    return document;
  });
}

/** Accepts the array and the common wrapper shapes; rejects anything else by name. */
export function readScoutradiozDocuments(content: string): ScoutradiozDocument[] {
  const first = content.trim().charAt(0);
  if (first !== "{" && first !== "[") return documentsFromCsv(content);
  const parsed = parseJsonOrReject(content, EXPECTED);
  let candidates: unknown[];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (isRecord(parsed)) {
    const wrapper = ["data", "matchscouting", "pitscouting", "documents", "rows"].find((key) =>
      Array.isArray(parsed[key]),
    );
    candidates = wrapper ? (parsed[wrapper] as unknown[]) : [parsed];
  } else {
    candidates = [parsed];
  }
  if (!candidates.length) return [];
  if (!candidates.some(looksLikeDocument)) {
    const found = isRecord(parsed)
      ? `That JSON has top-level keys ${Object.keys(parsed).slice(0, 8).join(", ") || "(none)"}.`
      : "That JSON is not a Scoutradioz export.";
    rejectShape(found, EXPECTED);
  }
  return candidates.filter(looksLikeDocument);
}

export type ScoutradiozImportInput = {
  content: string;
  /** Optional match/pit form layout, used to drop layout-only elements by name. */
  layout?: ScoutradiozLayoutItem[];
  /** Only documents for this event are imported when set; others are skipped by name. */
  eventKey?: string;
  sourceFile?: string;
  now?: Date;
};

/**
 * Scoutradioz documents -> scouting entry drafts.
 *
 * Rows without the identity Vantage needs (event key, `frcNNNN` team key, and
 * for match rows a `match_key`) are skipped with the exact missing field.
 */
export function scoutradiozToDrafts(
  input: ScoutradiozImportInput,
): ImportResult<ScoutEntryDraft> {
  const result = emptyResult<ScoutEntryDraft>();
  const documents = readScoutradiozDocuments(input.content);
  const now = input.now ?? new Date();

  // Layout-only ids are dropped from every row's payload, reported once.
  const droppedIds = new Map<string, string>();
  for (const item of input.layout ?? []) {
    const reason = item?.type ? SCOUTRADIOZ_NON_ANSWER_LAYOUT[item.type] : undefined;
    if (!reason) continue;
    const id = typeof item.id === "string" && item.id ? item.id : item.label;
    if (id) droppedIds.set(id, reason);
    else result.skipped.push({ ref: `layout "${item.type}"`, reason });
  }
  for (const [id, reason] of droppedIds) {
    result.skipped.push({ ref: `field ${id}`, reason });
  }

  const seen = new Set<string>();

  documents.forEach((document, index) => {
    const ref = document.match_team_key ?? document.team_key ?? `document ${index + 1}`;
    if (!isRecord(document.data)) {
      result.skipped.push({ ref, reason: "no data object — this row was assigned but never scouted" });
      return;
    }
    const teamKeyRaw = typeof document.team_key === "string" ? document.team_key.trim() : "";
    if (!/^frc\d+$/.test(teamKeyRaw)) {
      result.skipped.push({ ref, reason: "team_key is missing or is not in frcNNNN form" });
      return;
    }
    const matchKey = typeof document.match_key === "string" ? document.match_key.trim() : "";
    const eventKey =
      (typeof document.event_key === "string" ? document.event_key.trim() : "") ||
      (matchKey ? matchKey.split("_")[0]! : "");
    if (!eventKey) {
      result.skipped.push({ ref, reason: "event_key is missing and could not be read from match_key" });
      return;
    }
    if (input.eventKey && eventKey !== input.eventKey) {
      result.skipped.push({
        ref,
        reason: `event_key is ${eventKey}, not the selected event ${input.eventKey}`,
      });
      return;
    }
    const entryType: "match" | "pit" = matchKey ? "match" : "pit";

    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(document.data)) {
      if (droppedIds.has(key)) continue;
      if (value === null || value === undefined || value === "") continue;
      payload[key] = value;
    }
    if (!Object.keys(payload).length) {
      result.skipped.push({ ref, reason: "every data field was empty or layout-only" });
      return;
    }

    // Scoutradioz's own per-row identity. Falls back to the same composition it
    // uses (`<match_key>_<team_key>`), or event+team for a pit row.
    const identity =
      (typeof document.match_team_key === "string" && document.match_team_key.trim()) ||
      (matchKey ? `${matchKey}_${teamKeyRaw}` : `${eventKey}_${teamKeyRaw}`);
    if (seen.has(identity)) {
      result.skipped.push({ ref, reason: `duplicate of an earlier row with the same identity ${identity}` });
      return;
    }
    seen.add(identity);

    result.drafts.push({
      kind: "scout",
      entryType,
      title: `${teamKeyRaw} · ${matchKey || eventKey}`,
      eventKey,
      ...(matchKey ? { matchKey } : {}),
      teamKey: teamKeyRaw,
      idempotencyKey: `scoutradioz:${identity}`,
      payload,
      provenance: provenanceNow(
        "scoutradioz",
        {
          sourceId: identity,
          sourceFile: input.sourceFile,
          sourceUrl: "https://scoutradioz.com",
        },
        now,
      ),
    });
  });

  return result;
}
