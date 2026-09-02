import { currentSeasonYear, defaultMatchSchema, defaultPitSchema, type GameField } from "@vantage/game-year";
import { lockScoutPayload } from "./identity";
import {
  assertStorageKeyForOrg,
  orgScopedStorageKey,
} from "./org-isolation";
export type Confidence = "high" | "normal" | "low";
export type EntrySource = "manual" | "voice" | "import" | "video";
export type EntryType = "match" | "pit";

/** Design-time form-builder field kinds (persisted on scout_form_fields). */
export type FormBuilderFieldType =
  | "dropdown"
  | "multiple_choice"
  | "short_answer"
  | "long_text"
  | "number"
  | "drivetrain_type"
  | "robot_image"
  /**
   * Scouting input studio types — the tap-first inputs real scouts asked for.
   * These live purely in the versioned jsonb schema definition, so they need no
   * migration and no new value on the scout_form_field_type DB enum.
   */
  | "counter"
  | "multi_counter"
  | "timer"
  | "rating"
  | "multi_select"
  | "slider"
  | "section_header"
  | "field_position";

/** Runtime + builder field types. Legacy boolean/text/select remain supported. */
export type FieldType =
  | "number"
  | "boolean"
  | "text"
  | "select"
  | FormBuilderFieldType;

export const DEFAULT_DRIVETRAIN_OPTIONS = [
  "swerve",
  "west_coast",
  "tank",
  "mecanum",
  "other",
] as const;

export {
  SCOUT_QR_EMBED_PREFIX,
  SCOUT_QR_HANDOFF_PREFIX,
  SCOUT_QR_MAX_EMBEDDED_BYTES,
  applyPendingToCoverage,
  decodeScoutQrContent,
  encodeScoutHandoffQr,
  encodeScoutQrPayload,
  embeddedQrByteLength,
  formatHandoffCode,
  importedToSyncEntries,
  mergeOfflineHandoff,
  needsShortCodeHandoff,
  normalizeHandoffCode,
  qrContentToImportJson,
  scoutHandoffUserCode,
  summarizeCoverage,
  syncEntriesToQrRecords,
  type CoverageDashboardCell,
  type OfflineMergeResult,
  type ScoutQrDecode,
  type ScoutQrRecord,
} from "./qr-handoff";
import { qrContentToImportJson } from "./qr-handoff";

/** Builder UI hint — entry forms may use this for radio vs select / short vs textarea. */
export type FieldWidget =
  | "mc"
  | "short"
  | "free"
  | "dropdown"
  | "number"
  | "yesno"
  | "drivetrain"
  | "robot_image"
  | "counter"
  | "multi_counter"
  | "timer"
  | "rating"
  | "multi_select"
  | "slider"
  | "section"
  | "field_position";

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  disagreementThreshold?: number;
  helpText?: string;
  config?: Record<string, unknown>;
  /** Soft-UI form builder presentation; ignored by payload validation. */
  widget?: FieldWidget;
};

export type SchemaDefinition = { title: string; fields: FieldDefinition[] };

/* ------------------------------------------------------------------------- *
 * Conditional visibility ("show only when").
 *
 * Persisted as `field.config.visibleWhen`. A hidden field is skipped by the
 * required check in validatePayload so an offline entry never gets stuck in the
 * sync outbox behind a question the scout could not see. Cycles fail OPEN (the
 * field stays visible) so a bad condition can never silently drop a required
 * answer. The entry renderers call the same evaluator via
 * apps/web/lib/scouting/conditional.ts.
 * ------------------------------------------------------------------------- */

export type FieldVisibilityOp = "eq" | "neq" | "gt" | "lt" | "truthy";

export const FIELD_VISIBILITY_OPS: readonly FieldVisibilityOp[] = ["eq", "neq", "gt", "lt", "truthy"];

/** `config.visibleWhen` — show this field only when another field's answer matches. */
export type FieldVisibilityCondition = {
  fieldKey: string;
  op: FieldVisibilityOp;
  value?: unknown;
};

export function isFieldVisibilityOp(value: unknown): value is FieldVisibilityOp {
  return typeof value === "string" && (FIELD_VISIBILITY_OPS as readonly string[]).includes(value);
}

/** Total reader: the stored condition, or null when absent / malformed. */
export function visibleWhenOf(field: Pick<FieldDefinition, "config">): FieldVisibilityCondition | null {
  const raw = field.config?.visibleWhen;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const fieldKey = typeof record.fieldKey === "string" ? record.fieldKey.trim() : "";
  if (!fieldKey || !isFieldVisibilityOp(record.op)) return null;
  return { fieldKey, op: record.op, value: record.value };
}

function isAnswerTruthy(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}

function answerNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function answerMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => answerMatches(item, expected));
  if (actual === expected) return true;
  if (actual == null || expected == null) return false;
  if (typeof actual === "boolean" || typeof expected === "boolean") {
    return String(actual).toLowerCase() === String(expected).toLowerCase();
  }
  const a = answerNumber(actual);
  const b = answerNumber(expected);
  if (a != null && b != null) return a === b;
  return String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase();
}

/** Pure: does `condition` hold against `payload`? Ignores whether the source field is itself hidden. */
export function conditionHolds(condition: FieldVisibilityCondition, payload: Record<string, unknown>): boolean {
  const actual = payload[condition.fieldKey];
  switch (condition.op) {
    case "truthy":
      return isAnswerTruthy(actual);
    case "eq":
      return answerMatches(actual, condition.value);
    case "neq":
      return !answerMatches(actual, condition.value);
    case "gt":
    case "lt": {
      const a = answerNumber(actual);
      const b = answerNumber(condition.value);
      if (a == null || b == null) return false;
      return condition.op === "gt" ? a > b : a < b;
    }
    default:
      return true;
  }
}

/**
 * Is `field` visible for `payload`? Follows the chain: a field whose controller is
 * itself hidden is hidden too. A cycle or a dangling controller fails open.
 */
export function evaluateFieldVisibility(
  field: Pick<FieldDefinition, "key" | "config">,
  payload: Record<string, unknown>,
  fieldsByKey: ReadonlyMap<string, Pick<FieldDefinition, "key" | "config">>,
): boolean {
  // Walk the controller chain first. Any repeat is a loop: the whole chain fails open.
  const chain: Array<{ condition: FieldVisibilityCondition; live: boolean }> = [];
  const seen = new Set<string>();
  let current = field;
  for (;;) {
    const condition = visibleWhenOf(current);
    if (!condition) break;
    if (seen.has(current.key)) return true;
    seen.add(current.key);
    const controller = fieldsByKey.get(condition.fieldKey);
    // A dangling or self reference is ignored (visible) — but fields that depend on
    // THIS field still evaluate their own condition against its answer.
    const live = Boolean(controller) && controller!.key !== current.key;
    chain.push({ condition, live });
    if (!live) break;
    current = controller!;
  }
  // Outermost controller first: a hidden controller hides everything under it.
  for (let index = chain.length - 1; index >= 0; index--) {
    const link = chain[index]!;
    if (link.live && !conditionHolds(link.condition, payload)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------------- *
 * Scouting input studio — config readers, math, and shape guards.
 *
 * Every reader is total: it takes whatever survived a jsonb round-trip and
 * returns a usable config, so an old or hand-edited schema never crashes entry.
 * Client renderers and server validation both go through these, which is what
 * keeps "the tablet accepted it" and "the server accepted it" the same rule.
 * ------------------------------------------------------------------------- */

/** Field types that carry no answer at all — layout only. */
export const LAYOUT_ONLY_FIELD_TYPES: readonly FieldType[] = ["section_header"];

export function isLayoutOnlyField(field: Pick<FieldDefinition, "type">): boolean {
  return LAYOUT_ONLY_FIELD_TYPES.includes(field.type);
}

/** Fields that hold a real answer — what the accuracy budget should count. */
export function answerableFields(definition: SchemaDefinition): FieldDefinition[] {
  return definition.fields.filter((field) => !isLayoutOnlyField(field));
}

type ConfigBag = Record<string, unknown>;

function configOf(field: Pick<FieldDefinition, "config">): ConfigBag {
  return field.config && typeof field.config === "object" ? (field.config as ConfigBag) : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function wholeNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric != null && Number.isInteger(numeric) ? numeric : null;
}

function clampInt(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

/* ----------------------------- counter ----------------------------------- */

/** CD ask: "+1 plus a bulk button" — tally cycles by tapping, never by typing. */
export const DEFAULT_COUNTER_STEPS = [1, 5, 10] as const;

export type CounterConfig = {
  /** Ascending, de-duplicated positive step sizes; the first is the primary tap. */
  steps: number[];
  allowNegative: boolean;
  /** Lower bound; 0 unless the field explicitly allows negatives. */
  min: number;
  /** Upper bound, or null for unbounded. */
  max: number | null;
};

export function counterConfig(field: Pick<FieldDefinition, "config">): CounterConfig {
  const raw = configOf(field);
  const steps = Array.isArray(raw.steps)
    ? raw.steps
        .map((step) => wholeNumber(step))
        .filter((step): step is number => step != null && step > 0)
    : [];
  const allowNegative = raw.allowNegative === true;
  const max = wholeNumber(raw.max);
  const explicitMin = wholeNumber(raw.min);
  const min = explicitMin != null ? explicitMin : allowNegative ? Number.NEGATIVE_INFINITY : 0;
  const unique = [...new Set(steps)].sort((a, b) => a - b);
  return {
    steps: unique.length ? unique : [...DEFAULT_COUNTER_STEPS],
    allowNegative,
    min,
    max: max != null && max >= (Number.isFinite(min) ? min : max) ? max : null,
  };
}

export function clampCounterValue(value: number, config: CounterConfig): number {
  let next = Math.round(value);
  if (config.max != null && next > config.max) next = config.max;
  if (next < config.min) next = Number.isFinite(config.min) ? config.min : next;
  return next;
}

export function counterValueOf(value: unknown): number {
  return wholeNumber(value) ?? 0;
}

/**
 * One counter tap. `delta` may be any configured step (or its negative for the
 * undo/minus tap); the result is always clamped back inside the field's range.
 */
export function applyCounterStep(
  current: unknown,
  delta: number,
  config: CounterConfig,
): number {
  return clampCounterValue(counterValueOf(current) + Math.round(delta), config);
}

/* -------------------------- multi counter -------------------------------- */

export type MultiCounterEntry = { key: string; label: string };
export type MultiCounterConfig = CounterConfig & { counters: MultiCounterEntry[] };

export function multiCounterKey(label: string, index: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return slug || `counter_${index + 1}`;
}

export function multiCounterConfig(field: Pick<FieldDefinition, "config">): MultiCounterConfig {
  const raw = configOf(field);
  const base = counterConfig(field);
  const source = Array.isArray(raw.counters) ? raw.counters : [];
  const seen = new Set<string>();
  const counters: MultiCounterEntry[] = [];
  source.forEach((item, index) => {
    const label =
      typeof item === "string"
        ? item
        : isPlainObject(item) && typeof item.label === "string"
          ? item.label
          : "";
    const declaredKey =
      isPlainObject(item) && typeof item.key === "string" && item.key.trim()
        ? item.key.trim()
        : multiCounterKey(label, index);
    if (!label.trim() && !declaredKey) return;
    let key = declaredKey;
    let suffix = 2;
    while (seen.has(key)) {
      key = `${declaredKey}_${suffix}`;
      suffix += 1;
    }
    seen.add(key);
    counters.push({ key, label: label.trim() || key });
  });
  return { ...base, counters };
}

export function multiCounterValueOf(
  value: unknown,
  config: MultiCounterConfig,
): Record<string, number> {
  const bag = isPlainObject(value) ? value : {};
  const next: Record<string, number> = {};
  for (const counter of config.counters) {
    next[counter.key] = wholeNumber(bag[counter.key]) ?? 0;
  }
  return next;
}

export function applyMultiCounterStep(
  current: unknown,
  counterKey: string,
  delta: number,
  config: MultiCounterConfig,
): Record<string, number> {
  const next = multiCounterValueOf(current, config);
  if (!(counterKey in next)) return next;
  next[counterKey] = clampCounterValue((next[counterKey] ?? 0) + Math.round(delta), config);
  return next;
}

export function multiCounterTotal(value: unknown, config: MultiCounterConfig): number {
  return Object.values(multiCounterValueOf(value, config)).reduce((sum, item) => sum + item, 0);
}

/* ------------------------------- timer ----------------------------------- */

export type TimerMode = "total" | "lap";
export type TimerConfig = { mode: TimerMode; maxSeconds: number | null };

export function timerConfig(field: Pick<FieldDefinition, "config">): TimerConfig {
  const raw = configOf(field);
  const mode: TimerMode = raw.mode === "lap" ? "lap" : "total";
  const maxSeconds = finiteNumber(raw.maxSeconds);
  return { mode, maxSeconds: maxSeconds != null && maxSeconds > 0 ? maxSeconds : null };
}

/** Trim float noise so a stopwatch never stores 4.300000000000001 seconds. */
export function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

export function normalizeTimerLaps(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((lap) => finiteNumber(lap))
    .filter((lap): lap is number => lap != null && lap >= 0)
    .map(roundSeconds);
}

/** Lap mode total — the number a cycle-time column actually wants. */
export function accumulateTimerLaps(laps: readonly number[]): number {
  return roundSeconds(laps.reduce((sum, lap) => sum + (Number.isFinite(lap) ? lap : 0), 0));
}

export function timerTotalSeconds(value: unknown, config: TimerConfig): number {
  if (config.mode === "lap") return accumulateTimerLaps(normalizeTimerLaps(value));
  return roundSeconds(Math.max(0, finiteNumber(value) ?? 0));
}

export function timerAverageLapSeconds(value: unknown): number | null {
  const laps = normalizeTimerLaps(value);
  if (!laps.length) return null;
  return roundSeconds(accumulateTimerLaps(laps) / laps.length);
}

export function formatTimerSeconds(seconds: number): string {
  const safe = Math.max(0, roundSeconds(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const restText = rest.toFixed(1).padStart(4, "0");
  return minutes > 0 ? `${minutes}:${restText}` : `${restText}s`;
}

/* ------------------------------- rating ---------------------------------- */

export type RatingConfig = { max: number };
export const RATING_MIN_STARS = 2;
export const RATING_MAX_STARS = 10;

export function ratingConfig(field: Pick<FieldDefinition, "config">): RatingConfig {
  const raw = configOf(field);
  const max = wholeNumber(raw.max);
  return { max: max != null ? clampInt(max, RATING_MIN_STARS, RATING_MAX_STARS) : 5 };
}

/** Tapping the star you already selected clears the rating (no "stuck at 1"). */
export function toggleRatingValue(current: unknown, star: number, config: RatingConfig): number | undefined {
  const next = clampInt(star, 1, config.max);
  return wholeNumber(current) === next ? undefined : next;
}

/* ------------------------------- slider ---------------------------------- */

export type SliderConfig = {
  min: number;
  max: number;
  step: number;
  minLabel: string | null;
  maxLabel: string | null;
};

export function sliderConfig(field: Pick<FieldDefinition, "config">): SliderConfig {
  const raw = configOf(field);
  const min = finiteNumber(raw.min) ?? 0;
  const maxRaw = finiteNumber(raw.max);
  const max = maxRaw != null && maxRaw > min ? maxRaw : min + 10;
  const stepRaw = finiteNumber(raw.step);
  const step = stepRaw != null && stepRaw > 0 && stepRaw <= max - min ? stepRaw : 1;
  const labels = isPlainObject(raw.labels) ? raw.labels : {};
  const minLabel = typeof labels.min === "string" && labels.min.trim() ? labels.min.trim() : null;
  const maxLabel = typeof labels.max === "string" && labels.max.trim() ? labels.max.trim() : null;
  return { min, max, step, minLabel, maxLabel };
}

export function isSliderValueAligned(value: number, config: SliderConfig): boolean {
  const offset = (value - config.min) / config.step;
  return Math.abs(offset - Math.round(offset)) < 1e-6;
}

export function snapSliderValue(value: number, config: SliderConfig): number {
  const steps = Math.round((value - config.min) / config.step);
  const snapped = config.min + steps * config.step;
  const bounded = Math.min(config.max, Math.max(config.min, snapped));
  return Math.round(bounded * 1e6) / 1e6;
}

/* --------------------------- field position ------------------------------ */

export type FieldPositionConfig = {
  gridCols: number;
  gridRows: number;
  /** Optional whitelist of tappable cell indices; null means every cell. */
  allowedCells: number[] | null;
};

export const FIELD_POSITION_MIN_GRID = 2;
export const FIELD_POSITION_MAX_GRID = 12;

export function fieldPositionConfig(field: Pick<FieldDefinition, "config">): FieldPositionConfig {
  const raw = configOf(field);
  const cols = wholeNumber(raw.gridCols);
  const rows = wholeNumber(raw.gridRows);
  const gridCols = cols != null ? clampInt(cols, FIELD_POSITION_MIN_GRID, FIELD_POSITION_MAX_GRID) : 6;
  const gridRows = rows != null ? clampInt(rows, FIELD_POSITION_MIN_GRID, FIELD_POSITION_MAX_GRID) : 3;
  const cellCount = gridCols * gridRows;
  const allowed = Array.isArray(raw.allowedCells)
    ? [
        ...new Set(
          raw.allowedCells
            .map((cell) => wholeNumber(cell))
            .filter((cell): cell is number => cell != null && cell >= 0 && cell < cellCount),
        ),
      ].sort((a, b) => a - b)
    : null;
  return { gridCols, gridRows, allowedCells: allowed && allowed.length ? allowed : null };
}

export function fieldPositionCellCount(config: Pick<FieldPositionConfig, "gridCols" | "gridRows">): number {
  return config.gridCols * config.gridRows;
}

export function isFieldPositionCellAllowed(cell: number, config: FieldPositionConfig): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= fieldPositionCellCount(config)) return false;
  return config.allowedCells ? config.allowedCells.includes(cell) : true;
}

/**
 * Season-proof grid label: column letter + row number ("C2"). No game art and
 * no field-element names, so a published form survives the next game reveal.
 */
export function fieldPositionCellLabel(
  cell: number,
  config: Pick<FieldPositionConfig, "gridCols" | "gridRows">,
): string {
  if (!Number.isInteger(cell) || cell < 0 || cell >= fieldPositionCellCount(config)) return "";
  const col = cell % config.gridCols;
  const row = Math.floor(cell / config.gridCols);
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

export function normalizeFieldPositionCells(value: unknown, config: FieldPositionConfig): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((cell) => wholeNumber(cell))
        .filter((cell): cell is number => cell != null && isFieldPositionCellAllowed(cell, config)),
    ),
  ].sort((a, b) => a - b);
}

export function toggleFieldPositionCell(
  value: unknown,
  cell: number,
  config: FieldPositionConfig,
): number[] {
  const current = normalizeFieldPositionCells(value, config);
  if (!isFieldPositionCellAllowed(cell, config)) return current;
  return current.includes(cell)
    ? current.filter((item) => item !== cell)
    : [...current, cell].sort((a, b) => a - b);
}

/* ----------------------- form reset behavior ----------------------------- */

/**
 * What happens to a field's answer after a save. CD ask: keep the constants
 * (scouting station, alliance colour) and step the match number, so a scout
 * taps straight into the next match instead of retyping the same three boxes.
 */
export type FormResetBehavior = "preserve" | "reset" | "increment";

export function fieldResetBehavior(field: Pick<FieldDefinition, "config">): FormResetBehavior {
  const raw = configOf(field).resetBehavior;
  return raw === "preserve" || raw === "increment" ? raw : "reset";
}

/** Increment a number, or the trailing digits of a string ("qm12" → "qm13"). */
export function incrementValue(value: unknown): unknown {
  const numeric = finiteNumber(value);
  if (numeric != null) return numeric + 1;
  if (typeof value === "string") {
    const match = /^(.*?)(\d+)(\D*)$/.exec(value);
    if (match) {
      const [, prefix = "", digits = "", suffix = ""] = match;
      const next = String(Number(digits) + 1);
      return `${prefix}${next.padStart(digits.length, "0")}${suffix}`;
    }
  }
  return undefined;
}

/**
 * Payload for the next entry after a save. Fields set to reset (the default)
 * drop out entirely; preserve keeps the answer; increment steps it.
 */
export function applyFormResetBehavior(
  schema: SchemaDefinition,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (isLayoutOnlyField(field)) continue;
    const value = payload[field.key];
    if (value === undefined || value === null) continue;
    const behavior = fieldResetBehavior(field);
    if (behavior === "preserve") {
      next[field.key] = value;
    } else if (behavior === "increment") {
      const stepped = incrementValue(value);
      if (stepped !== undefined) next[field.key] = stepped;
    }
  }
  return next;
}

function gameFieldToDefinition(field: GameField): FieldDefinition {
  const widget: FieldWidget | undefined =
    field.type === "drivetrain_type"
      ? "drivetrain"
      : field.type === "robot_image"
        ? "robot_image"
        : undefined;
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options,
    helpText: field.helpText,
    widget,
  };
}

/** Generic interchange schema — video re-scout and imports that do not pin a season. */
export const DEFAULT_MATCH_SCHEMA: SchemaDefinition = {
  title: "Match scouting",
  fields: [
    { key: "auto_score", label: "Auto score", type: "number" },
    { key: "teleop_score", label: "Teleop score", type: "number" },
    {
      key: "endgame",
      label: "Endgame",
      type: "select",
      options: ["none", "partial", "full"],
    },
    { key: "disabled", label: "Disabled", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

export const DEFAULT_PIT_SCHEMA: SchemaDefinition = {
  title: "Pit scouting",
  fields: [
    {
      key: "drivetrain_type",
      label: "Drivetrain",
      type: "drivetrain_type",
      options: [...DEFAULT_DRIVETRAIN_OPTIONS],
      widget: "drivetrain",
    },
    {
      key: "robot_images",
      label: "Robot images",
      type: "robot_image",
      widget: "robot_image",
      helpText: "Upload or capture pit photos of the robot.",
    },
    { key: "cycle_time", label: "Cycle time (s)", type: "number" },
    { key: "reliable", label: "Reliable", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

export function matchSchemaForYear(year: number = currentSeasonYear()): SchemaDefinition {
  const schema = defaultMatchSchema(year);
  return { title: schema.title, fields: schema.fields.map(gameFieldToDefinition) };
}

export function pitSchemaForYear(year: number = currentSeasonYear()): SchemaDefinition {
  const schema = defaultPitSchema(year);
  return { title: schema.title, fields: schema.fields.map(gameFieldToDefinition) };
}

/** True when a robot_image payload holds one or more media client ids. */
export function isRobotImageValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

export function normalizeRobotImageRefs(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  return [];
}

export type ScoutSchema = {
  id: string;
  orgId: string;
  year: number;
  type: EntryType;
  version: number;
  definition: SchemaDefinition;
};

export type SyncEntry = {
  clientId: string;
  type: EntryType;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  schemaId: string;
  payload: Record<string, unknown>;
  confidence: Confidence;
  source: EntrySource;
  updatedAt: string;
  /** Offline outbox tenant stamp — never sync under a different orgId. */
  orgId?: string;
  videoReviewId?: string;
  videoAtSeconds?: number;
};

export type FormulaExpression =
  | { op: "field"; field: string }
  | { op: "constant"; value: number }
  | {
      op: "add" | "subtract" | "multiply" | "divide" | "min" | "max";
      args: FormulaExpression[];
    };

const STUDIO_FIELD_TYPES: ReadonlySet<string> = new Set([
  "counter",
  "multi_counter",
  "timer",
  "rating",
  "multi_select",
  "slider",
  "field_position",
]);

/**
 * Server-side mirror of what the studio entry renderers can produce.
 *
 * Returns null when `field` is not a studio type (the caller falls through to
 * the legacy chain), otherwise the list of range/shape errors — empty when the
 * value is good. Anything a tablet cannot produce is rejected here too, so a
 * hand-crafted sync POST cannot smuggle out-of-range values past the UI.
 */
function validateStudioFieldValue(field: FieldDefinition, value: unknown): string[] | null {
  if (!STUDIO_FIELD_TYPES.has(field.type)) return null;
  const errors: string[] = [];
  const label = field.label;

  if (field.type === "counter") {
    const config = counterConfig(field);
    const numeric = wholeNumber(value);
    if (numeric == null) {
      errors.push(`${label} must be a whole number`);
    } else {
      if (!config.allowNegative && numeric < 0) {
        errors.push(`${label} cannot go below zero`);
      } else if (Number.isFinite(config.min) && numeric < config.min) {
        errors.push(`${label} must be at least ${config.min}`);
      }
      if (config.max != null && numeric > config.max) {
        errors.push(`${label} must be at most ${config.max}`);
      }
    }
    return errors;
  }

  if (field.type === "multi_counter") {
    const config = multiCounterConfig(field);
    if (!isPlainObject(value)) {
      errors.push(`${label} must be a set of named counts`);
      return errors;
    }
    const known = new Set(config.counters.map((counter) => counter.key));
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) {
        errors.push(`${label} has an unknown counter: ${key}`);
        continue;
      }
      const numeric = wholeNumber(raw);
      if (numeric == null) {
        errors.push(`${label} · ${key} must be a whole number`);
        continue;
      }
      if (!config.allowNegative && numeric < 0) {
        errors.push(`${label} · ${key} cannot go below zero`);
      } else if (Number.isFinite(config.min) && numeric < config.min) {
        errors.push(`${label} · ${key} must be at least ${config.min}`);
      }
      if (config.max != null && numeric > config.max) {
        errors.push(`${label} · ${key} must be at most ${config.max}`);
      }
    }
    return errors;
  }

  if (field.type === "timer") {
    const config = timerConfig(field);
    if (config.mode === "lap") {
      if (!Array.isArray(value)) {
        errors.push(`${label} must be a list of lap times in seconds`);
        return errors;
      }
      for (const lap of value) {
        const numeric = finiteNumber(lap);
        if (numeric == null || numeric < 0) {
          errors.push(`${label} has a lap that is not a number of seconds`);
          break;
        }
      }
      if (!errors.length && config.maxSeconds != null) {
        const total = accumulateTimerLaps(normalizeTimerLaps(value));
        if (total > config.maxSeconds) {
          errors.push(`${label} totals more than ${config.maxSeconds}s`);
        }
      }
      return errors;
    }
    const numeric = finiteNumber(value);
    if (numeric == null) {
      errors.push(`${label} must be a number of seconds`);
    } else if (numeric < 0) {
      errors.push(`${label} cannot be negative`);
    } else if (config.maxSeconds != null && numeric > config.maxSeconds) {
      errors.push(`${label} must be at most ${config.maxSeconds}s`);
    }
    return errors;
  }

  if (field.type === "rating") {
    const config = ratingConfig(field);
    const numeric = wholeNumber(value);
    if (numeric == null) {
      errors.push(`${label} must be a whole-number rating`);
    } else if (numeric < 1 || numeric > config.max) {
      errors.push(`${label} must be between 1 and ${config.max}`);
    }
    return errors;
  }

  if (field.type === "multi_select") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      errors.push(`${label} must be a list of options`);
      return errors;
    }
    const picks = value as string[];
    if (new Set(picks).size !== picks.length) {
      errors.push(`${label} has a duplicate option`);
    }
    const options = field.options ?? [];
    if (!options.length) {
      errors.push(`${label} has no options defined`);
    } else if (picks.some((pick) => !options.includes(pick))) {
      errors.push(`${label} has an invalid option`);
    }
    return errors;
  }

  if (field.type === "slider") {
    const config = sliderConfig(field);
    const numeric = finiteNumber(value);
    if (numeric == null) {
      errors.push(`${label} must be a number`);
    } else if (numeric < config.min || numeric > config.max) {
      errors.push(`${label} must be between ${config.min} and ${config.max}`);
    } else if (!isSliderValueAligned(numeric, config)) {
      errors.push(`${label} must land on a step of ${config.step}`);
    }
    return errors;
  }

  // field_position — indices only. Never store coordinates, images, or labels.
  const config = fieldPositionConfig(field);
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a list of grid cells`);
    return errors;
  }
  const cellCount = fieldPositionCellCount(config);
  const seen = new Set<number>();
  for (const cell of value) {
    const numeric = wholeNumber(cell);
    if (numeric == null || numeric < 0 || numeric >= cellCount) {
      errors.push(`${label} has a cell outside the ${config.gridCols}×${config.gridRows} grid`);
      break;
    }
    if (seen.has(numeric)) {
      errors.push(`${label} has a duplicate cell`);
      break;
    }
    seen.add(numeric);
    if (config.allowedCells && !config.allowedCells.includes(numeric)) {
      errors.push(`${label} has a cell that is not selectable on this form`);
      break;
    }
  }
  return errors;
}

export function validatePayload(
  schema: SchemaDefinition,
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const allowed = new Set(schema.fields.map((field) => field.key));
  const byKey = new Map(schema.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) errors.push(`Unknown field: ${key}`);
  }
  for (const field of schema.fields) {
    const value = payload[field.key];
    // A field the scout could not see ("show only when") must never block a save.
    const visible = evaluateFieldVisibility(field, payload, byKey);
    // Section headers group Auto | Teleop | Endgame — they carry no answer, and
    // "required" is meaningless on them, so they never gate a save.
    if (isLayoutOnlyField(field)) {
      if (value !== undefined && value !== null && value !== "") {
        errors.push(`${field.label} is a section header and stores no answer`);
      }
      continue;
    }
    const empty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0) ||
      (field.type === "multi_counter" && isPlainObject(value) && Object.keys(value).length === 0);
    if (field.required && empty && visible) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (empty) continue;
    const studioErrors = validateStudioFieldValue(field, value);
    if (studioErrors) {
      errors.push(...studioErrors);
      continue;
    }
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`${field.label} must be a number`);
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${field.label} must be true or false`);
    } else if (field.type === "robot_image") {
      if (!isRobotImageValue(value)) {
        errors.push(`${field.label} must be a media id or list of media ids`);
      }
    } else if (
      (field.type === "text" ||
        field.type === "select" ||
        field.type === "dropdown" ||
        field.type === "short_answer" ||
        field.type === "long_text" ||
        field.type === "drivetrain_type") &&
      typeof value !== "string"
    ) {
      errors.push(`${field.label} must be text`);
    } else if (field.type === "multiple_choice") {
      const allowMultiple = field.config?.allowMultiple === true;
      if (allowMultiple) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          errors.push(`${field.label} must be a list of options`);
        } else if (field.options?.length) {
          for (const item of value) {
            if (!field.options.includes(item)) {
              errors.push(`${field.label} has an invalid option`);
              break;
            }
          }
        }
      } else if (typeof value !== "string") {
        errors.push(`${field.label} must be text`);
      } else if (field.options?.length && !field.options.includes(value)) {
        errors.push(`${field.label} has an invalid option`);
      }
    } else if (
      (field.type === "select" || field.type === "dropdown") &&
      field.options?.length &&
      !field.options.includes(String(value))
    ) {
      errors.push(`${field.label} has an invalid option`);
    } else if (field.type === "drivetrain_type") {
      const options =
        field.options?.length ? field.options : [...DEFAULT_DRIVETRAIN_OPTIONS];
      if (!options.includes(String(value))) {
        errors.push(`${field.label} has an invalid drivetrain type`);
      }
    }
  }
  return errors;
}

export function evaluateFormula(
  expression: FormulaExpression,
  payload: Record<string, unknown>,
): number {
  if (expression.op === "constant") return expression.value;
  if (expression.op === "field") {
    const value = payload[expression.field];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  const values = expression.args.map((arg) => evaluateFormula(arg, payload));
  if (values.length === 0) return 0;
  switch (expression.op) {
    case "add":
      return values.reduce((sum, value) => sum + value, 0);
    case "subtract":
      return values.slice(1).reduce((result, value) => result - value, values[0] ?? 0);
    case "multiply":
      return values.reduce((result, value) => result * value, 1);
    case "divide":
      return values.slice(1).reduce(
        (result, value) => (value === 0 ? result : result / value),
        values[0] ?? 0,
      );
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

export type Disagreement = {
  fieldKey: string;
  entryIds: string[];
  values: unknown[];
};

export function detectDisagreements(
  schema: SchemaDefinition,
  entries: Array<{ id: string; payload: Record<string, unknown>; confidence: Confidence }>,
): Disagreement[] {
  const eligible = entries.filter((entry) => entry.confidence !== "low");
  if (eligible.length < 2) return [];
  const disagreements: Disagreement[] = [];
  for (const field of schema.fields) {
    // Attachment refs are not comparable categorical answers; section headers
    // hold nothing; stopwatch and tap-a-cell answers differ between two honest
    // scouts by nature, so flagging them would be noise, not disagreement.
    if (
      field.type === "robot_image" ||
      field.type === "section_header" ||
      field.type === "timer" ||
      field.type === "field_position"
    ) {
      continue;
    }
    const observed = eligible
      .map((entry) => ({ id: entry.id, value: entry.payload[field.key] }))
      .filter(({ value }) => value !== undefined && value !== null);
    if (observed.length < 2) continue;
    const values = observed.map(({ value }) => value);
    const numericLike =
      field.type === "number" ||
      field.type === "counter" ||
      field.type === "rating" ||
      field.type === "slider";
    const diverges = numericLike
      ? Math.max(...values.map(Number)) - Math.min(...values.map(Number)) >
        (field.disagreementThreshold ?? 0)
      : new Set(
          values.map((value) =>
            // Multi-select order is a UI artifact, not a disagreement.
            JSON.stringify(
              field.type === "multi_select" && Array.isArray(value)
                ? [...value].map(String).sort()
                : value,
            ),
          ),
        ).size > 1;
    if (diverges) {
      disagreements.push({
        fieldKey: field.key,
        entryIds: observed.map(({ id }) => id),
        values,
      });
    }
  }
  return disagreements;
}

export interface MediaStorage {
  createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }): Promise<{ storageKey: string; uploadUrl: string }>;
}

export class LocalMediaStorage implements MediaStorage {
  async createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }) {
    const storageKey = orgScopedStorageKey(input.orgId, input.clientId);
    assertStorageKeyForOrg(storageKey, input.orgId);
    return {
      storageKey,
      uploadUrl: `/api/scouting/media/${encodeURIComponent(input.clientId)}?orgId=${encodeURIComponent(input.orgId)}`,
    };
  }
}

export {
  assertExplicitOrgAccess,
  assertResourceInOrg,
  assertStorageKeyForOrg,
  filterMediaForOrg,
  filterSchemasForOrg,
  filterVoiceNotesForOrg,
  isWrongOrgDenied,
  orgIdFromUploadUrl,
  orgScopedStorageKey,
  OrgIsolationError,
  partitionByOrgId,
  resourceBelongsToOrg,
  storageKeyBelongsToOrg,
  wouldCrossOrgLeak,
} from "./org-isolation";

export {
  applyVoiceTranscriptToForm,
  BrowserVoiceDraftAdapter,
  coerceVoiceFieldValue,
  normalizeVoiceLabel,
  type VoiceDraftAdapter,
} from "./voice";

export type ImportProvenance = {
  format: "csv" | "json" | "qr";
  source: "scoutingpass" | "scout_radioactive" | "frc_scouting" | "google_sheets" | "vantage" | "generic";
  importedAt: string;
  sourceFile?: string;
};

export type ImportedScoutRecord = {
  clientId: string;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  payload: Record<string, unknown>;
  provenance: ImportProvenance;
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value");
  values.push(value);
  return values;
}

export function importScoutData(input: {
  content: string;
  format: "csv" | "json" | "qr";
  source?: ImportProvenance["source"];
  sourceFile?: string;
  now?: Date;
}): ImportedScoutRecord[] {
  const provenance: ImportProvenance = {
    format: input.format,
    source: input.source ?? "generic",
    importedAt: (input.now ?? new Date()).toISOString(),
    sourceFile: input.sourceFile,
  };
  let values: unknown[];
  if (input.format === "csv") {
    const lines = input.content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]!).map((header) => header.trim());
    values = lines.slice(1).map((line) =>
      Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index] ?? ""])),
    );
  } else {
    const decoded =
      input.format === "qr" ? qrContentToImportJson(input.content) : input.content;
    const parsed = JSON.parse(decoded) as unknown;
    values = Array.isArray(parsed) ? parsed : [parsed];
  }
  return values.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Import row ${index + 1} must be an object`);
    const row = raw as Record<string, unknown>;
    const normalized = new Map(Object.entries(row).map(([key,value])=>[key.toLowerCase().replace(/[^a-z0-9]/g,""),value]));
    const pick=(...aliases:string[])=>aliases.map((key)=>normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g,""))).find((value)=>value!=null&&value!=="");
    const eventKey = String(pick("eventKey","event","eventCode","competition") ?? "").trim();
    const matchRaw=String(pick("matchKey","match","matchNumber","matchNum")??"").trim();
    const matchKey = matchRaw ? (/^\d+$/.test(matchRaw)?`qm${matchRaw}`:matchRaw) : undefined;
    const teamValue = String(pick("teamKey","team","teamNumber","teamNum","robot") ?? "").trim();
    const teamKey = /^frc\d+$/i.test(teamValue) ? teamValue.toLowerCase() : `frc${teamValue}`;
    if (!eventKey || !/^frc\d+$/.test(teamKey)) throw new Error(`Import row ${index + 1} lacks event/team identity`);
    const reserved = new Set([
      "clientId", "client_id", "eventKey", "event_key", "event", "matchKey", "match_key", "match",
      "teamKey", "team_key", "team", "teamNumber", "payload",
      "Event Key", "Event Code", "Match Number", "Match Num", "Team Number", "Team Num", "Robot",
    ]);
    const rawPayload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : Object.fromEntries(Object.entries(row).filter(([key]) => !reserved.has(key)));
    // CD #4 — never persist free-text scout names from CSV/JSON/QR imports.
    const payload = lockScoutPayload(rawPayload).payload;
    return {
      clientId: String(row.clientId ?? row.client_id ?? `import-${index}-${eventKey}-${teamKey}`),
      eventKey,
      matchKey,
      teamKey,
      payload,
      provenance,
    };
  });
}

export function smallTeamAssignments(input: {
  scouts: string[];
  matches: Array<{ matchKey: string; teamKeys: string[] }>;
}) {
  if (!input.scouts.length) return [];
  return input.matches.flatMap((match, matchIndex) =>
    match.teamKeys.map((teamKey, teamIndex) => ({
      matchKey: match.matchKey,
      teamKey,
      userId: input.scouts[(matchIndex + teamIndex) % input.scouts.length]!,
      mode: "small-team" as const,
    })),
  );
}

export {
  assertSchemaIdentityLock,
  bindScoutIdentity,
  isScoutIdentityField,
  lockScoutPayload,
  stripScoutIdentityFields,
  SCOUT_IDENTITY_LOCK_COPY,
  type ScoutIdentity,
} from "./identity";

export {
  buildCoverageGapBoard,
  focusLiveCoverage,
  summarizeCoverageGaps,
  toGapStatus,
  type CoverageGapSlot,
  type CoverageGapStatus,
  type CoverageGapSummary,
  type CoverageSlotInput,
} from "./coverage";

export {
  buildChoseScoutResolution,
  buildDismissResolution,
  formatConflictValue,
  resolutionSummary,
  validateResolution,
  zipCandidates,
  type AuditAction,
  type DisagreementCandidate,
  type DisagreementResolution,
  type ResolutionOutcome,
} from "./resolution";
