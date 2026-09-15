/**
 * Wide CSV of this event's scout answers — identity plus one column per published
 * match/pit form field. Takeout at /exports can keep payload as a JSON blob; this
 * is the Sheets dump leads actually open at lunch.
 *
 * Empty event → header row only. Never invents a scout row.
 */

import {
  answerableFields,
  fieldPositionCellLabel,
  fieldPositionConfig,
  multiCounterConfig,
  normalizeFieldPositionCells,
  normalizeRobotImageRefs,
  normalizeTimerLaps,
  timerConfig,
  timerTotalSeconds,
  type EntryType,
  type FieldDefinition,
  type FieldType,
  type SchemaDefinition,
} from "@vantage/scouting";
import { toCsv, type CsvCell, type CsvColumn } from "../export/to-csv";

export type EventAnswerRow = {
  type: EntryType;
  eventKey: string;
  matchKey: string | null;
  teamKey: string;
  scoutName: string;
  source: string;
  confidence: string;
  updatedAt: string;
  payload: Record<string, unknown>;
};

export type EventAnswersSnapshot = {
  eventKey: string | null;
  matchDefinition: SchemaDefinition | null;
  pitDefinition: SchemaDefinition | null;
  rows: EventAnswerRow[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function asScoutPayload(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function schemaKindLabel(type: EntryType): string {
  return type === "match" ? "Match" : "Pit";
}

function payloadColumnKey(type: EntryType, fieldKey: string, counterKey?: string): string {
  return counterKey ? `${type}.${fieldKey}.${counterKey}` : `${type}.${fieldKey}`;
}

function payloadColumnHeader(type: EntryType, field: FieldDefinition, counterLabel?: string): string {
  const prefix = `${schemaKindLabel(type)} · ${field.label}`;
  return counterLabel ? `${prefix} · ${counterLabel}` : prefix;
}

function csvFromAnswer(field: FieldDefinition, value: unknown): CsvCell {
  const type: FieldType = field.type;
  switch (type) {
    case "section_header":
      return null;
    case "number":
    case "counter":
    case "rating":
    case "slider":
      return finiteNumber(value);
    case "boolean":
      return typeof value === "boolean" ? value : null;
    case "text":
    case "select":
    case "dropdown":
    case "multiple_choice":
    case "short_answer":
    case "long_text":
    case "drivetrain_type":
      if (typeof value === "string") return value;
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return null;
    case "robot_image": {
      const refs = normalizeRobotImageRefs(value);
      return refs.length ? refs : null;
    }
    case "multi_select":
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
        : null;
    case "timer": {
      if (value == null || value === "") return null;
      const config = timerConfig(field);
      if (config.mode === "lap") {
        const laps = normalizeTimerLaps(value);
        return laps.length ? laps : null;
      }
      return timerTotalSeconds(value, config);
    }
    case "field_position": {
      const config = fieldPositionConfig(field);
      const cells = normalizeFieldPositionCells(value, config);
      if (!cells.length) return null;
      return cells.map((cell) => fieldPositionCellLabel(cell, config));
    }
    case "multi_counter": {
      if (!isPlainObject(value)) return null;
      const config = multiCounterConfig(field);
      const known = new Set(config.counters.map((counter) => counter.key));
      const parts = Object.entries(value)
        .filter(([key, raw]) => (!known.size || known.has(key)) && finiteNumber(raw) != null)
        .map(([key, raw]) => `${key}=${raw as number}`);
      return parts.length ? parts.join("; ") : null;
    }
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function readPayloadCell(
  row: EventAnswerRow,
  schemaType: EntryType,
  field: FieldDefinition,
  counterKey?: string,
): CsvCell {
  if (row.type !== schemaType) return null;
  const payload = asScoutPayload(row.payload);
  if (counterKey) {
    const raw = payload[field.key];
    if (!isPlainObject(raw) || !Object.prototype.hasOwnProperty.call(raw, counterKey)) return null;
    return finiteNumber(raw[counterKey]);
  }
  if (!Object.prototype.hasOwnProperty.call(payload, field.key)) return null;
  return csvFromAnswer(field, payload[field.key]);
}

function payloadColumnsForSchema(
  type: EntryType,
  definition: SchemaDefinition | null,
): CsvColumn<EventAnswerRow>[] {
  if (!definition) return [];
  const columns: CsvColumn<EventAnswerRow>[] = [];
  for (const field of answerableFields(definition)) {
    if (field.type === "multi_counter") {
      const counters = multiCounterConfig(field).counters;
      if (counters.length) {
        for (const counter of counters) {
          columns.push({
            key: payloadColumnKey(type, field.key, counter.key),
            header: payloadColumnHeader(type, field, counter.label),
            hint: `${schemaKindLabel(type)} form — ${field.label} (${counter.label})`,
            value: (row) => readPayloadCell(row, type, field, counter.key),
          });
        }
        continue;
      }
    }
    columns.push({
      key: payloadColumnKey(type, field.key),
      header: payloadColumnHeader(type, field),
      hint: `${schemaKindLabel(type)} form — ${field.label}`,
      value: (row) => readPayloadCell(row, type, field),
    });
  }
  return columns;
}

export const EVENT_ANSWER_IDENTITY_COLUMNS: CsvColumn<EventAnswerRow>[] = [
  { key: "eventKey", header: "Event", hint: "Active event key", value: (row) => row.eventKey },
  { key: "matchKey", header: "Match", hint: "Blank for pit entries", value: (row) => row.matchKey },
  { key: "teamKey", header: "Team", hint: "Team key, e.g. frc1678", value: (row) => row.teamKey },
  { key: "type", header: "Type", hint: "match or pit" },
  { key: "scoutName", header: "Scout", hint: "Who submitted it" },
  { key: "source", header: "Source", hint: "How it arrived (form, QR handoff, import, video)" },
  { key: "confidence", header: "Confidence", hint: "Scout's own confidence flag" },
  {
    key: "updatedAt",
    header: "Updated at",
    hint: "ISO-8601 UTC — latest timestamp wins per entry",
    value: (row) => row.updatedAt,
  },
];

/** Identity metadata plus one column per published match/pit answer field. */
export function eventAnswerColumns(
  matchDefinition: SchemaDefinition | null,
  pitDefinition: SchemaDefinition | null,
): CsvColumn<EventAnswerRow>[] {
  return [
    ...EVENT_ANSWER_IDENTITY_COLUMNS,
    ...payloadColumnsForSchema("match", matchDefinition),
    ...payloadColumnsForSchema("pit", pitDefinition),
  ];
}

export function eventAnswersCsv(snapshot: Pick<EventAnswersSnapshot, "rows" | "matchDefinition" | "pitDefinition">): string {
  return toCsv(snapshot.rows, eventAnswerColumns(snapshot.matchDefinition, snapshot.pitDefinition));
}
