/**
 * QRScout — https://github.com/frc2713/QRScout
 *
 * Two importers, both driven by the same config.json:
 *  (a) config.json  -> a Vantage scouting FORM DRAFT (unpublished).
 *  (b) QR payload lines -> scouting entry drafts, keyed by that config.
 *
 * Verified against the repo's published `src/assets/schema.json` and the real
 * `config/2025/config.json`:
 *  - Root requires title, page_title, delimiter, teamNumber, sections.
 *    `year` and `floatingField`/`theme` are optional.
 *  - A section is `{ name, fields }`; a field requires `title`, `type`,
 *    `required`, `code`, where `code` is the unique column id.
 *  - The 14 published types are: counter, multi-counter, text, number, select,
 *    multi-select, checkbox-select, range, boolean, timer, image,
 *    action-tracker, TBA-team-and-robot, TBA-match-number.
 *  - The 2025 config also carries the legacy `multiSelect: true` flag on a
 *    `select`, which renders as a multi-select.
 *
 * QR PAYLOAD (verified in src/components/QR/QRModal.tsx + src/store/store.ts):
 *  - The payload is `fieldValues.map(toQrString).join(config.delimiter)` — one
 *    column per field value, in section then field order.
 *  - `action-tracker` is the one type that is NOT one column: it expands to
 *    `{code}_{action}_count` and `{code}_{action}_times` for every action, so
 *    the column count only lines up if we expand it the same way.
 *  - multi-select / checkbox-select values are stored comma-joined.
 *  - `TBA-team-and-robot` holds an object and serializes to its teamNumber.
 *  - Newlines inside a value are replaced with a space before joining.
 */

import { createHash } from "node:crypto";
import {
  provenanceNow,
  type ScoutEntryDraft,
  type ScoutFormDraft,
  type ScoutFormFieldDraft,
} from "./provenance";
import {
  emptyResult,
  isRecord,
  parseJsonOrReject,
  rejectShape,
  type ImportResult,
} from "./result";
import { toFieldKey, type VantageFieldType } from "./vantage-fields";

export const QRSCOUT_FIELD_TYPES = [
  "counter",
  "multi-counter",
  "text",
  "number",
  "select",
  "multi-select",
  "checkbox-select",
  "range",
  "boolean",
  "timer",
  "image",
  "action-tracker",
  "TBA-team-and-robot",
  "TBA-match-number",
] as const;

export type QrScoutFieldType = (typeof QRSCOUT_FIELD_TYPES)[number];

export type QrScoutAction = { code?: string; title?: string; name?: string };

export type QrScoutField = {
  title: string;
  code: string;
  type: string;
  required?: boolean;
  description?: string;
  disabled?: boolean;
  defaultValue?: unknown;
  choices?: Record<string, string>;
  /** Legacy flag seen on the published 2025 config: a `select` that multi-selects. */
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  outputType?: string;
  actions?: QrScoutAction[];
  mode?: string;
};

export type QrScoutSection = { name: string; fields: QrScoutField[] };

export type QrScoutConfig = {
  title: string;
  page_title: string;
  delimiter: string;
  teamNumber?: number;
  year?: number;
  sections: QrScoutSection[];
};

const EXPECTED_CONFIG =
  "a QRScout config.json with a \"delimiter\" string and a \"sections\" array, " +
  "where each section is { name, fields: [{ title, type, required, code }] }.";

/** Reject anything that is not a QRScout config, naming what was expected. */
export function readQrScoutConfig(content: string): QrScoutConfig {
  const parsed = parseJsonOrReject(content, EXPECTED_CONFIG);
  if (!isRecord(parsed)) {
    rejectShape("That JSON is not an object.", EXPECTED_CONFIG);
  }
  if (!Array.isArray(parsed.sections)) {
    const keys = Object.keys(parsed).slice(0, 8).join(", ") || "(none)";
    rejectShape(`That JSON has no "sections" array (top-level keys: ${keys}).`, EXPECTED_CONFIG);
  }
  const sections: QrScoutSection[] = [];
  parsed.sections.forEach((raw, index) => {
    if (!isRecord(raw) || !Array.isArray(raw.fields)) {
      rejectShape(`Section #${index + 1} has no "fields" array.`, EXPECTED_CONFIG);
    }
    const fields: QrScoutField[] = [];
    (raw.fields as unknown[]).forEach((field, fieldIndex) => {
      if (!isRecord(field) || typeof field.code !== "string" || typeof field.type !== "string") {
        rejectShape(
          `Field #${fieldIndex + 1} of section "${String(raw.name ?? index + 1)}" is missing a string "code" or "type".`,
          EXPECTED_CONFIG,
        );
      }
      fields.push({
        ...(field as QrScoutField),
        code: field.code as string,
        type: field.type as string,
        title: typeof field.title === "string" ? field.title : (field.code as string),
      });
    });
    sections.push({ name: typeof raw.name === "string" ? raw.name : `Section ${index + 1}`, fields });
  });
  const delimiter = typeof parsed.delimiter === "string" ? parsed.delimiter : "";
  if (!delimiter) {
    rejectShape('That config has no "delimiter" string.', EXPECTED_CONFIG);
  }
  return {
    title: typeof parsed.title === "string" ? parsed.title : "QRScout",
    page_title: typeof parsed.page_title === "string" ? parsed.page_title : "",
    delimiter,
    teamNumber: typeof parsed.teamNumber === "number" ? parsed.teamNumber : undefined,
    year: typeof parsed.year === "number" ? parsed.year : undefined,
    sections,
  };
}

/* -------------------------------------------------------------------------- *
 * (a) config.json -> form draft
 * -------------------------------------------------------------------------- */

/** How one QRScout type lands in Vantage, and what (if anything) is lost. */
type TypeMapping = {
  type: VantageFieldType;
  /** Set when the Vantage union has no exact equivalent — reported in skipped[]. */
  approximation?: string;
};

function mapFieldType(field: QrScoutField): TypeMapping | { unsupported: string } {
  switch (field.type) {
    case "counter":
      return { type: "counter" };
    case "multi-counter":
      return { type: "multi_counter" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "timer":
      return { type: "timer" };
    case "range":
      return { type: "slider" };
    case "image":
      return { type: "robot_image" };
    case "text":
      // The published schema uses `max` as a string length.
      return { type: typeof field.max === "number" && field.max > 120 ? "long_text" : "short_answer" };
    case "select":
      return { type: field.multiSelect ? "multi_select" : "dropdown" };
    case "multi-select":
    case "checkbox-select":
      return { type: "multi_select" };
    case "action-tracker":
      return {
        type: "multi_counter",
        approximation:
          "QRScout \"action-tracker\" has no Vantage equivalent — imported as a multi-counter of its actions, " +
          "so the per-action timestamps it records are not carried over.",
      };
    case "TBA-match-number":
      return {
        type: "number",
        approximation:
          "QRScout \"TBA-match-number\" has no Vantage equivalent — imported as a plain number field. " +
          "Vantage takes the match from the event schedule instead, so you can usually delete this field.",
      };
    case "TBA-team-and-robot":
      return { unsupported: "identity" };
    default:
      return { unsupported: "unknown" };
  }
}

/** Choice objects are `{ storedValue: shownLabel }`; we keep the stored values. */
function choiceValues(field: QrScoutField): string[] {
  if (!isRecord(field.choices)) return [];
  return Object.keys(field.choices);
}

function fieldConfig(field: QrScoutField, mapped: VantageFieldType): Record<string, unknown> {
  const config: Record<string, unknown> = { qrscoutCode: field.code, qrscoutType: field.type };
  if (typeof field.min === "number" && mapped !== "short_answer" && mapped !== "long_text") {
    config.min = field.min;
  }
  if (typeof field.max === "number" && mapped !== "short_answer" && mapped !== "long_text") {
    config.max = field.max;
  }
  if (typeof field.step === "number") config.step = field.step;
  if (mapped === "multi_counter" && Array.isArray(field.actions)) {
    config.subCounters = field.actions
      .map((action) => ({
        key: toFieldKey(String(action?.code ?? action?.title ?? action?.name ?? ""), ""),
        label: String(action?.title ?? action?.name ?? action?.code ?? ""),
      }))
      .filter((sub) => sub.key && sub.label);
  }
  return config;
}

export type QrScoutFormInput = {
  content: string;
  entryType?: "match" | "pit";
  sourceFile?: string;
  now?: Date;
};

/**
 * config.json -> ONE unpublished form draft. Section names become
 * `section_header` fields so the imported form reads like the original.
 */
export function qrScoutConfigToFormDraft(
  input: QrScoutFormInput,
): ImportResult<ScoutFormDraft> {
  const result = emptyResult<ScoutFormDraft>();
  const config = readQrScoutConfig(input.content);
  const now = input.now ?? new Date();
  const fields: ScoutFormFieldDraft[] = [];
  const usedKeys = new Set<string>();

  for (const section of config.sections) {
    if (section.name) {
      const headerKey = toFieldKey(`section_${section.name}`, `section_${fields.length}`);
      if (!usedKeys.has(headerKey)) {
        usedKeys.add(headerKey);
        fields.push({ key: headerKey, label: section.name, type: "section_header" });
      }
    }
    for (const field of section.fields) {
      const ref = `${section.name} / ${field.title || field.code}`;
      if (field.disabled) {
        result.skipped.push({ ref, reason: "the QRScout field is disabled" });
        continue;
      }
      const mapping = mapFieldType(field);
      if ("unsupported" in mapping) {
        result.skipped.push({
          ref,
          reason:
            mapping.unsupported === "identity"
              ? "QRScout \"TBA-team-and-robot\" carries the scouted team. Vantage locks team and match identity " +
                "outside the form, so this is not imported as a question."
              : `QRScout type "${field.type}" is not one of the ${QRSCOUT_FIELD_TYPES.length} published types, so it was not imported.`,
        });
        continue;
      }
      if (mapping.approximation) result.skipped.push({ ref, reason: mapping.approximation });

      let key = toFieldKey(field.code, `field_${fields.length}`);
      if (usedKeys.has(key)) key = `${key}_${fields.length}`;
      usedKeys.add(key);

      const options = choiceValues(field);
      fields.push({
        key,
        label: field.title || field.code,
        type: mapping.type,
        required: field.required === true,
        ...(options.length ? { options } : {}),
        ...(field.description ? { helpText: field.description } : {}),
        config: fieldConfig(field, mapping.type),
      });
    }
  }

  if (!fields.some((field) => field.type !== "section_header")) {
    result.errors.push({
      ref: "config.json",
      message: "No answerable QRScout fields survived mapping, so there is no form to draft.",
    });
    return result;
  }

  result.drafts.push({
    kind: "form",
    entryType: input.entryType ?? "match",
    title: config.page_title || config.title,
    definition: { title: config.page_title || config.title, fields },
    provenance: provenanceNow(
      "qrscout",
      {
        sourceFile: input.sourceFile,
        sourceUrl: "https://github.com/frc2713/QRScout",
        sourceId: config.teamNumber ? `frc${config.teamNumber}` : undefined,
      },
      now,
    ),
  });
  return result;
}

/* -------------------------------------------------------------------------- *
 * (b) QR payload lines -> scouting entry drafts
 * -------------------------------------------------------------------------- */

export type QrScoutColumn = {
  code: string;
  label: string;
  /** The config field this column came from. */
  fieldCode: string;
  /**
   * The type the VALUE is encoded as, which is not always `field.type`: the
   * published 2025 config marks a multi-select with `multiSelect: true` on a
   * plain `select`, and its value is comma-joined like a real multi-select.
   */
  type: string;
};

function effectiveType(field: QrScoutField): string {
  if (field.type === "select" && field.multiSelect) return "multi-select";
  return field.type;
}

/**
 * The exact column order a QRScout payload uses, including the `_count` /
 * `_times` pair that every action-tracker action expands into. Getting this
 * wrong silently shifts every later value, so it mirrors `generateFieldValues`.
 */
export function qrScoutColumns(config: QrScoutConfig): QrScoutColumn[] {
  const columns: QrScoutColumn[] = [];
  for (const section of config.sections) {
    for (const field of section.fields) {
      if (field.type === "action-tracker" && Array.isArray(field.actions)) {
        for (const action of field.actions) {
          const actionCode = String(action?.code ?? action?.title ?? action?.name ?? "");
          columns.push({
            code: `${field.code}_${actionCode}_count`,
            label: `${field.title} · ${actionCode} count`,
            fieldCode: field.code,
            type: field.type,
          });
          columns.push({
            code: `${field.code}_${actionCode}_times`,
            label: `${field.title} · ${actionCode} times`,
            fieldCode: field.code,
            type: field.type,
          });
        }
        continue;
      }
      columns.push({
        code: field.code,
        label: field.title,
        fieldCode: field.code,
        type: effectiveType(field),
      });
    }
  }
  return columns;
}

function coerceValue(raw: string, type: string): unknown {
  if (raw === "") return "";
  switch (type) {
    case "boolean":
      return /^(true|1|yes|y)$/i.test(raw);
    case "counter":
    case "multi-counter":
    case "number":
    case "range":
    case "timer":
    case "TBA-match-number": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : raw;
    }
    case "multi-select":
    case "checkbox-select":
      return raw.split(",").map((part) => part.trim()).filter(Boolean);
    default:
      return raw;
  }
}

/** The codes QRScout configs conventionally use for the scouted team number. */
const TEAM_CODES = ["teamnumber", "team", "teamnum", "scoutedteam"];
const MATCH_CODES = ["matchnumber", "match", "matchnum"];

function findColumnIndex(columns: QrScoutColumn[], candidates: string[], byType?: string): number {
  if (byType) {
    const typed = columns.findIndex((column) => column.type === byType);
    if (typed >= 0) return typed;
  }
  return columns.findIndex((column) => candidates.includes(column.code.toLowerCase()));
}

export type QrScoutEntriesInput = {
  /** The config.json the QR codes were produced from — required for column order. */
  configContent: string;
  /** One QR payload per line, as scanned. */
  payloadContent: string;
  /** TBA event key. QRScout payloads do not carry one, so the user picks it. */
  eventKey: string;
  sourceFile?: string;
  now?: Date;
};

/**
 * QRScout payload lines -> match scouting entry drafts.
 *
 * A line whose column count does not match the config is REJECTED as an error
 * rather than best-guess trimmed: a shifted row would silently attribute one
 * robot's numbers to another.
 */
export function qrScoutPayloadsToDrafts(
  input: QrScoutEntriesInput,
): ImportResult<ScoutEntryDraft> {
  const result = emptyResult<ScoutEntryDraft>();
  const config = readQrScoutConfig(input.configContent);
  const columns = qrScoutColumns(config);
  const now = input.now ?? new Date();
  const eventKey = input.eventKey.trim();
  if (!eventKey) {
    result.errors.push({ ref: "event", message: "Pick the event these QR codes were scanned at." });
    return result;
  }

  const teamIndex = findColumnIndex(columns, TEAM_CODES, "TBA-team-and-robot");
  const matchIndex = findColumnIndex(columns, MATCH_CODES, "TBA-match-number");
  if (teamIndex < 0) {
    result.errors.push({
      ref: "config.json",
      message:
        "That config has no team-number column. Expected a field of type \"TBA-team-and-robot\" or a code of " +
        `${TEAM_CODES.join(" / ")}.`,
    });
    return result;
  }
  if (matchIndex < 0) {
    result.errors.push({
      ref: "config.json",
      message:
        "That config has no match-number column. Expected a field of type \"TBA-match-number\" or a code of " +
        `${MATCH_CODES.join(" / ")}.`,
    });
    return result;
  }

  const lines = input.payloadContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const seen = new Set<string>();

  lines.forEach((line, index) => {
    const ref = `line ${index + 1}`;
    const cells = line.split(config.delimiter);
    if (cells.length !== columns.length) {
      result.errors.push({
        ref,
        message: `That line has ${cells.length} values but the config defines ${columns.length} columns. Not imported — a shifted row would attribute one robot's numbers to another.`,
      });
      return;
    }
    const team = (cells[teamIndex] ?? "").trim();
    if (!/^\d+$/.test(team) || Number(team) < 1) {
      result.skipped.push({ ref, reason: `team number column "${columns[teamIndex]!.code}" is not a team number` });
      return;
    }
    const matchNumber = Number((cells[matchIndex] ?? "").trim());
    if (!Number.isInteger(matchNumber) || matchNumber < 1) {
      result.skipped.push({ ref, reason: `match number column "${columns[matchIndex]!.code}" is not a match number` });
      return;
    }

    const payload: Record<string, unknown> = {};
    columns.forEach((column, columnIndex) => {
      if (columnIndex === teamIndex || columnIndex === matchIndex) return;
      const value = coerceValue((cells[columnIndex] ?? "").trim(), column.type);
      if (value === "" || (Array.isArray(value) && !value.length)) return;
      payload[toFieldKey(column.code, `column_${columnIndex}`)] = value;
    });

    // Hash the payload line itself so re-scanning the same QR writes nothing new.
    const hash = createHash("sha256").update(`${eventKey} ${line}`).digest("hex");
    if (seen.has(hash)) {
      result.skipped.push({ ref, reason: "duplicate of an earlier line (identical payload)" });
      return;
    }
    seen.add(hash);

    const matchKey = `${eventKey}_qm${matchNumber}`;
    result.drafts.push({
      kind: "scout",
      entryType: "match",
      title: `frc${team} · ${matchKey}`,
      eventKey,
      matchKey,
      teamKey: `frc${team}`,
      idempotencyKey: `qrscout:${hash}`,
      payload,
      provenance: provenanceNow(
        "qrscout",
        {
          sourceId: hash,
          sourceFile: input.sourceFile,
          sourceUrl: "https://github.com/frc2713/QRScout",
        },
        now,
      ),
    });
  });

  return result;
}
