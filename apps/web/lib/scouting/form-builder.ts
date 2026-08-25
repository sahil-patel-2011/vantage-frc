import { lintPitClaimedScoring, lintSchemaBudget } from "@vantage/scouting/trust";
import {
  assertSchemaIdentityLock,
  isScoutIdentityField,
  stripScoutIdentityFields,
  SCOUT_IDENTITY_LOCK_COPY,
} from "@vantage/scouting/identity";
import {
  DEFAULT_COUNTER_STEPS,
  DEFAULT_DRIVETRAIN_OPTIONS,
  FIELD_POSITION_MAX_GRID,
  FIELD_POSITION_MIN_GRID,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
  answerableFields,
  counterConfig,
  fieldPositionConfig,
  fieldResetBehavior,
  isLayoutOnlyField,
  multiCounterConfig,
  multiCounterKey,
  ratingConfig,
  sliderConfig,
  timerConfig,
  type EntryType,
  type FieldDefinition,
  type FieldType,
  type FieldWidget,
  type FormResetBehavior,
  type SchemaDefinition,
  type TimerMode,
} from "@vantage/scouting";
import {
  inferRoleForFieldKey,
  isStrategyFieldRole,
  type StrategyFieldRole,
} from "@vantage/prediction-strategy";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export { SCOUT_IDENTITY_LOCK_COPY };
export type AnswerKind = FieldWidget;

export const ANSWER_KIND_OPTIONS: Array<{
  kind: AnswerKind;
  label: string;
  hint: string;
}> = [
  { kind: "mc", label: "Multiple choice", hint: "Tap one option (radio)" },
  { kind: "short", label: "Short answer", hint: "Single-line text" },
  { kind: "free", label: "Free text", hint: "Longer notes" },
  { kind: "dropdown", label: "Dropdown", hint: "Select from a list" },
  { kind: "number", label: "Number", hint: "Counts and scores" },
  { kind: "yesno", label: "Yes / No", hint: "Checkbox" },
  {
    kind: "drivetrain",
    label: "Drivetrain type",
    hint: "Swerve, west coast, tank, mecanum, or other",
  },
  {
    kind: "robot_image",
    label: "Robot images",
    hint: "Upload or capture pit photos (org-isolated storage)",
  },
  {
    kind: "counter",
    label: "Counter",
    hint: "Huge +1 and bulk (+5 / +10) taps with one-level undo",
  },
  {
    kind: "multi_counter",
    label: "Multi-counter",
    hint: "Several named tallies in one block (e.g. high / mid / low)",
  },
  {
    kind: "timer",
    label: "Stopwatch / timer",
    hint: "One giant start-stop; total seconds or a list of laps",
  },
  { kind: "rating", label: "Rating", hint: "Tap 1..N stars; tap again to clear" },
  {
    kind: "multi_select",
    label: "Multi-select",
    hint: "Pick any number of options — stored as a real list",
  },
  { kind: "slider", label: "Slider", hint: "Drag between a min and max with a fixed step" },
  {
    kind: "section",
    label: "Section header",
    hint: "Layout only — groups the questions under it (Auto / Teleop / Endgame)",
  },
  {
    kind: "field_position",
    label: "Field position",
    hint: "Tap a labeled grid cell; stores cell numbers only, never game art",
  },
];

/** Studio kinds whose entry UI is tap-first (big targets, eyes on the match). */
export const BIG_TARGET_ANSWER_KINDS: readonly AnswerKind[] = [
  "counter",
  "multi_counter",
  "timer",
  "rating",
  "field_position",
];

export const DRIVETRAIN_OPTIONS_TEXT = DEFAULT_DRIVETRAIN_OPTIONS.join(", ");

export type { StrategyFieldRole };

/** Builder select options for "Feeds strategy as" — persisted as field config.role. */
export const STRATEGY_ROLE_OPTIONS: Array<{
  role: StrategyFieldRole;
  label: string;
  hint: string;
}> = [
  {
    role: "none",
    label: "Auto-detect (default)",
    hint: "Maps by field name when it matches auto/teleop/endgame/defense/fouls/notes conventions",
  },
  { role: "auto_score", label: "Auto scoring", hint: "Feeds auto capability in strategy and pick tools" },
  { role: "teleop_score", label: "Teleop scoring", hint: "Feeds teleop/cycle capability" },
  { role: "endgame", label: "Endgame / climb", hint: "Feeds endgame capability" },
  { role: "defense", label: "Defense played", hint: "Flags defense-likely in strategy" },
  { role: "fouls", label: "Fouls / penalties", hint: "Feeds opponent foul-risk" },
  { role: "notes", label: "Notes / comments", hint: "Surfaces as pit or match notes in strategy" },
];

/**
 * What "Auto-detect" would resolve for a draft question right now —
 * stored key first (stable identity), else the label-derived slug.
 */
export function detectedRoleForQuestion(question: {
  key?: string;
  label: string;
}): StrategyFieldRole {
  const key = question.key?.trim() || slugifyKey(question.label || "", new Set());
  return inferRoleForFieldKey(key);
}

/** Effective strategy role of a published field: explicit config.role wins, else key inference. */
export function fieldStrategyRole(field: Pick<FieldDefinition, "key" | "config">): StrategyFieldRole {
  const configured = (field.config as { role?: unknown } | undefined)?.role;
  if (isStrategyFieldRole(configured)) return configured;
  return inferRoleForFieldKey(field.key);
}

/**
 * Per-kind builder settings. Everything here is serialized into the published
 * field's `config` bag, which is what the entry renderers and the server-side
 * validator both read — one source of truth for "what is in range".
 */
export type DraftFieldSettings = {
  /** counter / multi_counter */
  counterStepsText?: string;
  allowNegative?: boolean;
  maxText?: string;
  subCountersText?: string;
  /** timer */
  timerMode?: TimerMode;
  /** rating */
  ratingMax?: number;
  /** slider */
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;
  sliderMinLabel?: string;
  sliderMaxLabel?: string;
  /** field_position */
  gridCols?: number;
  gridRows?: number;
};

export type DraftQuestion = {
  id: string;
  /**
   * Stable published key. Once a field has shipped in a schema version, renaming
   * its label must NEVER change this — payloads stored under it stay reachable.
   * Empty for brand-new questions; assigned from the label at publish time.
   */
  key?: string;
  label: string;
  kind: AnswerKind;
  required: boolean;
  optionsText: string;
  /** Explicit strategy mapping; "none" defers to key-name auto-detection. */
  role: StrategyFieldRole;
  /** What happens to this answer after a save — preserve / reset / increment. */
  reset: FormResetBehavior;
  settings: DraftFieldSettings;
};

export const COUNTER_STEPS_TEXT = DEFAULT_COUNTER_STEPS.join(", ");

/** Sensible starting config when a question is first set to a studio kind. */
export function defaultSettingsForKind(kind: AnswerKind): DraftFieldSettings {
  switch (kind) {
    case "counter":
      return { counterStepsText: COUNTER_STEPS_TEXT, allowNegative: false, maxText: "" };
    case "multi_counter":
      return {
        counterStepsText: COUNTER_STEPS_TEXT,
        allowNegative: false,
        maxText: "",
        subCountersText: "High, Mid, Low",
      };
    case "timer":
      return { timerMode: "lap" };
    case "rating":
      return { ratingMax: 5 };
    case "slider":
      return { sliderMin: 0, sliderMax: 10, sliderStep: 1 };
    case "field_position":
      return { gridCols: 6, gridRows: 3 };
    default:
      return {};
  }
}

export function newDraftQuestion(partial?: Partial<DraftQuestion>): DraftQuestion {
  const kind = partial?.kind ?? "short";
  return {
    id: partial?.id ?? `q_${Math.random().toString(36).slice(2, 10)}`,
    key: partial?.key,
    label: partial?.label ?? "",
    kind,
    // A section header is a heading, never a gate on save.
    required: kind === "section" ? false : (partial?.required ?? false),
    optionsText:
      partial?.optionsText ??
      (kind === "drivetrain" ? DRIVETRAIN_OPTIONS_TEXT : ""),
    role: partial?.role ?? "none",
    reset: partial?.reset ?? "reset",
    settings: { ...defaultSettingsForKind(kind), ...(partial?.settings ?? {}) },
  };
}

/** Parse the builder's "1, 5, 10" bulk-step box into ascending unique steps. */
export function parseCounterSteps(text: string | undefined): number[] {
  const steps = (text ?? "")
    .split(/[\n,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((step) => Number.isFinite(step) && Number.isInteger(step) && step > 0);
  const unique = [...new Set(steps)].sort((a, b) => a - b);
  return unique.length ? unique : [...DEFAULT_COUNTER_STEPS];
}

/** Named sub-counters from the builder textarea; keys stay slug-stable. */
export function parseSubCounters(text: string | undefined): Array<{ key: string; label: string }> {
  const labels = parseOptions(text ?? "");
  const used = new Set<string>();
  return labels.map((label, index) => {
    let key = multiCounterKey(label, index);
    let suffix = 2;
    while (used.has(key)) {
      key = `${multiCounterKey(label, index)}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return { key, label };
  });
}

function optionalWholeNumber(text: string | undefined): number | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && Number.isInteger(value) ? value : null;
}

export function slugifyKey(label: string, used: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "field";
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

export function parseOptions(optionsText: string): string[] {
  return optionsText
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Persist option editor rows back into draft `optionsText`. */
export function serializeOptions(options: string[]): string {
  return options.map((part) => part.trim()).filter(Boolean).join(", ");
}

export function moveOption(options: string[], from: number, to: number): string[] {
  if (from < 0 || from >= options.length) return options;
  if (to < 0 || to >= options.length) return options;
  if (from === to) return options;
  const next = options.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return options;
  next.splice(to, 0, item);
  return next;
}

export function updateOptionAt(options: string[], index: number, value: string): string[] {
  if (index < 0 || index >= options.length) return options;
  const next = options.slice();
  next[index] = value;
  return next;
}

export function addOption(options: string[], value = ""): string[] {
  return [...options, value];
}

export function removeOption(options: string[], index: number): string[] {
  if (index < 0 || index >= options.length) return options;
  return options.filter((_, i) => i !== index);
}

export function needsOptionEditor(kind: AnswerKind): boolean {
  return kind === "mc" || kind === "dropdown" || kind === "drivetrain" || kind === "multi_select";
}

/** Kinds the scouting input studio renders (builder preview and live entry alike). */
export function isStudioAnswerKind(kind: AnswerKind): boolean {
  return (
    kind === "counter" ||
    kind === "multi_counter" ||
    kind === "timer" ||
    kind === "rating" ||
    kind === "multi_select" ||
    kind === "slider" ||
    kind === "section" ||
    kind === "field_position"
  );
}

/** Kinds whose config editor the builder should show under the question. */
export function needsSettingsEditor(kind: AnswerKind): boolean {
  return (
    kind === "counter" ||
    kind === "multi_counter" ||
    kind === "timer" ||
    kind === "rating" ||
    kind === "slider" ||
    kind === "field_position"
  );
}

export function kindToFieldType(kind: AnswerKind): FieldType {
  if (kind === "number") return "number";
  if (kind === "yesno") return "boolean";
  if (kind === "mc") return "multiple_choice";
  if (kind === "dropdown") return "dropdown";
  if (kind === "drivetrain") return "drivetrain_type";
  if (kind === "robot_image") return "robot_image";
  if (kind === "free") return "long_text";
  if (kind === "counter") return "counter";
  if (kind === "multi_counter") return "multi_counter";
  if (kind === "timer") return "timer";
  if (kind === "rating") return "rating";
  if (kind === "multi_select") return "multi_select";
  if (kind === "slider") return "slider";
  if (kind === "section") return "section_header";
  if (kind === "field_position") return "field_position";
  return "short_answer";
}

export function fieldToAnswerKind(field: FieldDefinition): AnswerKind {
  if (field.widget) return field.widget;
  if (field.type === "counter") return "counter";
  if (field.type === "multi_counter") return "multi_counter";
  if (field.type === "timer") return "timer";
  if (field.type === "rating") return "rating";
  if (field.type === "multi_select") return "multi_select";
  if (field.type === "slider") return "slider";
  if (field.type === "section_header") return "section";
  if (field.type === "field_position") return "field_position";
  if (field.type === "number") return "number";
  if (field.type === "boolean") return "yesno";
  if (field.type === "drivetrain_type") return "drivetrain";
  if (field.type === "robot_image") return "robot_image";
  if (field.type === "select" || field.type === "dropdown" || field.type === "multiple_choice") {
    return field.type === "multiple_choice" ? "mc" : "dropdown";
  }
  if (field.type === "long_text") return "free";
  if (field.type === "short_answer" || field.type === "text") return "short";
  return "short";
}

/** Read a published field's `config` bag back into editable builder settings. */
export function settingsFromField(field: FieldDefinition): DraftFieldSettings {
  switch (field.type) {
    case "counter": {
      const config = counterConfig(field);
      return {
        counterStepsText: config.steps.join(", "),
        allowNegative: config.allowNegative,
        maxText: config.max == null ? "" : String(config.max),
      };
    }
    case "multi_counter": {
      const config = multiCounterConfig(field);
      return {
        counterStepsText: config.steps.join(", "),
        allowNegative: config.allowNegative,
        maxText: config.max == null ? "" : String(config.max),
        subCountersText: config.counters.map((counter) => counter.label).join(", "),
      };
    }
    case "timer":
      return { timerMode: timerConfig(field).mode };
    case "rating":
      return { ratingMax: ratingConfig(field).max };
    case "slider": {
      const config = sliderConfig(field);
      return {
        sliderMin: config.min,
        sliderMax: config.max,
        sliderStep: config.step,
        sliderMinLabel: config.minLabel ?? "",
        sliderMaxLabel: config.maxLabel ?? "",
      };
    }
    case "field_position": {
      const config = fieldPositionConfig(field);
      return { gridCols: config.gridCols, gridRows: config.gridRows };
    }
    default:
      return {};
  }
}

/**
 * sessionStorage key for the one-shot handoff of an imported form definition
 * (e.g. the QRScout migrator) into the form builder. Written right before
 * navigation, consumed and removed on the builder's first draft load.
 */
export const IMPORTED_FORM_DRAFT_KEY = "vantage:scouting-form-draft";

export function draftFromDefinition(definition: SchemaDefinition): {
  title: string;
  questions: DraftQuestion[];
} {
  const { definition: locked } = stripScoutIdentityFields(definition);
  return {
    title: locked.title,
    questions: locked.fields.map((field) =>
      newDraftQuestion({
        id: field.key,
        key: field.key,
        label: field.label,
        kind: fieldToAnswerKind(field),
        required: Boolean(field.required),
        optionsText:
          field.type === "drivetrain_type" && !(field.options?.length)
            ? DRIVETRAIN_OPTIONS_TEXT
            : (field.options ?? []).join(", "),
        role: fieldStrategyRole(field),
        reset: fieldResetBehavior(field),
        settings: settingsFromField(field),
      }),
    ),
  };
}

/**
 * Serialize a studio question's builder settings into the published `config`.
 * Only what the type actually uses is written, so the jsonb stays readable and
 * two forms that differ only in an unused box are not "draft changes".
 */
export function studioConfigForQuestion(
  question: DraftQuestion,
  type: FieldType,
): Record<string, unknown> {
  const settings = question.settings ?? {};
  const config: Record<string, unknown> = {};
  if (type === "counter" || type === "multi_counter") {
    config.steps = parseCounterSteps(settings.counterStepsText);
    if (settings.allowNegative) config.allowNegative = true;
    const max = optionalWholeNumber(settings.maxText);
    if (max != null) config.max = max;
    if (type === "multi_counter") {
      config.counters = parseSubCounters(settings.subCountersText);
    }
    return config;
  }
  if (type === "timer") {
    config.mode = settings.timerMode === "total" ? "total" : "lap";
    return config;
  }
  if (type === "rating") {
    const max = Number(settings.ratingMax ?? 5);
    config.max = Number.isFinite(max)
      ? Math.min(RATING_MAX_STARS, Math.max(RATING_MIN_STARS, Math.round(max)))
      : 5;
    return config;
  }
  if (type === "slider") {
    const min = Number.isFinite(settings.sliderMin) ? Number(settings.sliderMin) : 0;
    const maxRaw = Number.isFinite(settings.sliderMax) ? Number(settings.sliderMax) : min + 10;
    const max = maxRaw > min ? maxRaw : min + 10;
    const stepRaw = Number.isFinite(settings.sliderStep) ? Number(settings.sliderStep) : 1;
    config.min = min;
    config.max = max;
    config.step = stepRaw > 0 && stepRaw <= max - min ? stepRaw : 1;
    const minLabel = (settings.sliderMinLabel ?? "").trim();
    const maxLabel = (settings.sliderMaxLabel ?? "").trim();
    if (minLabel || maxLabel) {
      config.labels = {
        ...(minLabel ? { min: minLabel } : {}),
        ...(maxLabel ? { max: maxLabel } : {}),
      };
    }
    return config;
  }
  if (type === "field_position") {
    const cols = Number(settings.gridCols ?? 6);
    const rows = Number(settings.gridRows ?? 3);
    config.gridCols = Math.min(
      FIELD_POSITION_MAX_GRID,
      Math.max(FIELD_POSITION_MIN_GRID, Number.isFinite(cols) ? Math.round(cols) : 6),
    );
    config.gridRows = Math.min(
      FIELD_POSITION_MAX_GRID,
      Math.max(FIELD_POSITION_MIN_GRID, Number.isFinite(rows) ? Math.round(rows) : 3),
    );
    return config;
  }
  return config;
}

/**
 * A single draft question as the published FieldDefinition it will become.
 *
 * The builder preview renders through this so "what the coach previews" and
 * "what the scout taps" are literally the same renderer reading the same config
 * — a preview that diverged from entry would be worse than no preview at all.
 * Not for persistence: `definitionFromDraft` owns key assignment.
 */
export function previewFieldForQuestion(question: DraftQuestion): FieldDefinition {
  const type = kindToFieldType(question.kind);
  const config = studioConfigForQuestion(question, type);
  const field: FieldDefinition = {
    key: question.key?.trim() || question.id,
    label: question.label.trim() || "Untitled",
    type,
    required: type !== "section_header" && question.required ? true : undefined,
    widget: question.kind,
  };
  if (Object.keys(config).length) field.config = config;
  if (
    type === "multiple_choice" ||
    type === "dropdown" ||
    type === "drivetrain_type" ||
    type === "multi_select"
  ) {
    const options = parseOptions(
      question.kind === "drivetrain" && !question.optionsText.trim()
        ? DRIVETRAIN_OPTIONS_TEXT
        : question.optionsText,
    );
    field.options = options.length
      ? options
      : type === "drivetrain_type"
        ? [...DEFAULT_DRIVETRAIN_OPTIONS]
        : options;
  }
  return field;
}

/**
 * Switching a question's answer type re-seeds the per-kind config.
 *
 * The stored `key` and the label are deliberately untouched: retyping a
 * published field must never re-key it, or every payload already saved under
 * the old key falls out of reach.
 */
export function retypeQuestion(question: DraftQuestion, kind: AnswerKind): DraftQuestion {
  if (question.kind === kind) return question;
  const next: DraftQuestion = {
    ...question,
    kind,
    settings: { ...defaultSettingsForKind(kind), ...carryOverSettings(question, kind) },
    // A section header is a heading; it can never gate a save.
    required: kind === "section" ? false : question.required,
    // Nothing to preserve or step when there is no answer.
    reset: kind === "section" ? "reset" : question.reset,
  };
  if (kind === "drivetrain" && !next.optionsText.trim()) {
    next.optionsText = DRIVETRAIN_OPTIONS_TEXT;
  }
  if (kind === "mc" || kind === "dropdown" || kind === "multi_select") {
    if (parseOptions(next.optionsText).length < 2) next.optionsText = "Option A, Option B";
  }
  return next;
}

/** Keep settings that mean the same thing in the new kind (counter ↔ multi-counter). */
function carryOverSettings(question: DraftQuestion, kind: AnswerKind): DraftFieldSettings {
  const counterish = (value: AnswerKind) => value === "counter" || value === "multi_counter";
  if (!counterish(question.kind) || !counterish(kind)) return {};
  const { counterStepsText, allowNegative, maxText, subCountersText } = question.settings ?? {};
  return {
    ...(counterStepsText ? { counterStepsText } : {}),
    ...(allowNegative ? { allowNegative } : {}),
    ...(maxText ? { maxText } : {}),
    ...(kind === "multi_counter" && subCountersText ? { subCountersText } : {}),
  };
}

/** Builder copy for the per-field "after save" control. */
export const RESET_BEHAVIOR_OPTIONS: Array<{
  behavior: FormResetBehavior;
  label: string;
  hint: string;
}> = [
  { behavior: "reset", label: "Clear it", hint: "Default — the next match starts blank" },
  {
    behavior: "preserve",
    label: "Keep the answer",
    hint: "For constants a scout would only retype (station, alliance colour)",
  },
  {
    behavior: "increment",
    label: "Step it up by one",
    hint: "For counting-up answers; text ending in digits steps too (qm12 → qm13)",
  },
];

export function definitionFromDraft(
  title: string,
  questions: DraftQuestion[],
): SchemaDefinition {
  const used = new Set<string>();
  const assigned = new Map<DraftQuestion, string>();
  // Pass 1 — stored keys are identity. Reserve them first so renamed labels and
  // newly added questions can never re-key or steal an already-published field
  // (payloads saved under the old key would become invisible to strategy).
  for (const question of questions) {
    const stored = question.key?.trim();
    if (stored && !used.has(stored)) {
      used.add(stored);
      assigned.set(question, stored);
    }
  }
  // Pass 2 — brand-new questions get label-derived keys against the reserved set.
  for (const question of questions) {
    if (assigned.has(question)) continue;
    let key: string;
    if (question.kind === "drivetrain" && !used.has("drivetrain_type")) {
      key = "drivetrain_type";
      used.add(key);
    } else if (question.kind === "robot_image" && !used.has("robot_images")) {
      key = "robot_images";
      used.add(key);
    } else {
      key = slugifyKey(question.label || question.id, used);
    }
    assigned.set(question, key);
  }
  const fields: FieldDefinition[] = questions.map((question) => {
    const type = kindToFieldType(question.kind);
    const key = assigned.get(question)!;
    const field: FieldDefinition = {
      key,
      label: question.label.trim() || "Untitled",
      type,
      // A section header is a heading; "required" on it would block saves forever.
      required: (type !== "section_header" && question.required) || undefined,
      widget: question.kind,
    };
    const config: Record<string, unknown> = {};
    // "none" means auto-detect by key name — persist only explicit mappings so
    // untouched conventional fields keep reaching strategy via inference.
    if (question.role !== "none") config.role = question.role;
    // "reset" is the default everywhere; only persist a deliberate choice.
    if (question.reset !== "reset" && type !== "section_header") {
      config.resetBehavior = question.reset;
    }
    Object.assign(config, studioConfigForQuestion(question, type));
    if (Object.keys(config).length) field.config = config;
    if (
      type === "select" ||
      type === "dropdown" ||
      type === "multiple_choice" ||
      type === "drivetrain_type" ||
      type === "multi_select"
    ) {
      const options = parseOptions(
        question.kind === "drivetrain" && !question.optionsText.trim()
          ? DRIVETRAIN_OPTIONS_TEXT
          : question.optionsText,
      );
      field.options =
        options.length > 0
          ? options
          : type === "drivetrain_type"
            ? [...DEFAULT_DRIVETRAIN_OPTIONS]
            : options;
    }
    if (type === "robot_image") {
      field.helpText = "Upload or capture pit photos of the robot.";
    }
    return field;
  });
  return { title: title.trim() || "Scouting form", fields };
}

export function moveQuestion(questions: DraftQuestion[], from: number, to: number): DraftQuestion[] {
  if (from < 0 || from >= questions.length) return questions;
  if (to < 0 || to >= questions.length) return questions;
  if (from === to) return questions;
  const next = questions.slice();
  const [item] = next.splice(from, 1);
  if (!item) return questions;
  next.splice(to, 0, item);
  return next;
}

export type DraftPublishKind = "unpublished" | "published" | "draft_changes";

export type DraftPublishStatus = {
  kind: DraftPublishKind;
  label: string;
  detail: string;
  version?: number;
};

/**
 * Config bag minus `role` (compared separately as an effective role) so that
 * publishing studio settings flags a real draft change while a legacy schema
 * with no config never flags a phantom one.
 */
function stableConfigFingerprint(field: FieldDefinition): string {
  const config = { ...(field.config as Record<string, unknown> | undefined) };
  delete config.role;
  const keys = Object.keys(config).sort();
  if (!keys.length) return "";
  return JSON.stringify(keys.map((key) => [key, config[key]]));
}

function stableDefinitionFingerprint(definition: SchemaDefinition): string {
  return JSON.stringify({
    title: definition.title.trim(),
    fields: definition.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
      required: Boolean(field.required),
      options: field.options ?? [],
      widget: field.widget ?? null,
      helpText: field.helpText ?? null,
      config: stableConfigFingerprint(field),
      // Effective role (explicit config.role, else key inference) so publishing
      // roles onto a legacy schema does not flag a phantom draft change.
      role: fieldStrategyRole(field),
    })),
  });
}

/** Compare the in-progress draft to the latest published schema for Soft-UI status. */
export function resolveDraftPublishStatus(args: {
  published: { version: number; definition: SchemaDefinition } | null | undefined;
  draftTitle: string;
  draftQuestions: DraftQuestion[];
}): DraftPublishStatus {
  const { published, draftTitle, draftQuestions } = args;
  if (!published) {
    return {
      kind: "unpublished",
      label: "Draft — not published",
      detail: "Scouts will not see this form until you publish a version for this season.",
    };
  }
  const draftDef = definitionFromDraft(draftTitle, draftQuestions);
  const dirty =
    stableDefinitionFingerprint(draftDef) !==
    stableDefinitionFingerprint(published.definition);
  if (dirty) {
    return {
      kind: "draft_changes",
      label: `Draft changes · published v${published.version}`,
      detail: "Edits are local until you publish. Live scouting keeps using the published version.",
      version: published.version,
    };
  }
  return {
    kind: "published",
    label: `Published v${published.version}`,
    detail: "This draft matches the live form scouts use after sync.",
    version: published.version,
  };
}

export type PostSaveNextStep = {
  id: string;
  href: string;
  label: string;
  detail: string;
};

/** After a successful local save, point scouts at real strategy / coverage surfaces (never DEMO). */
export function scoutingPostSaveNextSteps(
  orgId: string,
  options?: { eventKey?: string | null; entryType?: EntryType },
): PostSaveNextStep[] {
  const entryHint =
    options?.entryType === "pit"
      ? "Pit notes feed pick strategy once synced."
      : "Match notes feed alliance strategy once synced.";
  const coverage = withOrgHref("/scout-coverage-live", orgId);
  const lineup = withOrgHref("/scouting/lineup", orgId);
  const eventQs =
    options?.eventKey != null && options.eventKey !== ""
      ? `&eventKey=${encodeURIComponent(options.eventKey)}`
      : "";
  return [
    {
      id: "strategy",
      href: hubHref("/competition", "strategy", orgId),
      label: "Open strategy",
      detail: entryHint,
    },
    {
      id: "coverage",
      href: `${coverage}${eventQs}`,
      label: "Coverage live",
      detail: "See which matches and teams still need scouts.",
    },
    {
      id: "lineup",
      href: `${lineup}${eventQs}`,
      label: "Lineup & coverage",
      detail: "Assignments and gaps for this event.",
    },
  ];
}

/** Soft-UI related surfaces for Form builder (never DEMO fields). */
export const FORM_BUILDER_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
  { id: "offline", label: "Offline", kind: "path" as const, path: "/offline" },
] as const;

export type FormBuilderRelatedId = (typeof FORM_BUILDER_RELATED_LINKS)[number]["id"];

export type FormBuilderRelatedLink = {
  id: FormBuilderRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Coverage. */
export const FORM_BUILDER_RELATED_INCLUDE: FormBuilderRelatedId[] = [
  "scouting",
  "coverage",
];

/**
 * Soft-UI cross-links from Form builder → Scouting / Coverage.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function formBuilderRelatedLinks(
  orgId?: string | null,
  options?: { active?: FormBuilderRelatedId; include?: FormBuilderRelatedId[] },
): FormBuilderRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FORM_BUILDER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type FormBuilderShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type FormBuilderNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type FormBuilderEmptyCopy = {
  kind: FormBuilderShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO fields. */
export type FormBuilderSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function formBuilderSetupSteps(orgId?: string | null): FormBuilderSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — published schemas stay org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Event Day Command sets the season year match and pit forms publish under.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live entry uses the published schema after sync — never DEMO fields.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
  ];
}

/** Classify Form builder Soft-UI shell — never invents DEMO fields. */
export function classifyFormBuilderShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  eventKey?: string | null;
  year?: number | null;
  hasPublishedSchema?: boolean;
}): FormBuilderShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || !input.eventKey || input.year == null) return "setup";
  if (!input.hasPublishedSchema) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO fields. */
export function formBuilderShellCopy(
  kind: FormBuilderShellKind,
  options?: { entryType?: EntryType },
): FormBuilderEmptyCopy {
  const typeLabel = options?.entryType === "pit" ? "pit" : "match";
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading form builder…",
        description:
          "Checking workspace, active event, and published schemas — never DEMO fields.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load form builder",
        description:
          "A network or server issue blocked schemas. Retry, or open Scouting / Coverage while it reloads — never invent DEMO fields.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Form builder is org- and season-scoped. Pick a workspace and set an active TBA event so the publish year is known — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "Not published",
        title: `No ${typeLabel} form published yet`,
        description:
          `Draft questions stay local until you publish a ${typeLabel} schema. Scouts and Coverage stay blank until a real version exists — never DEMO fields.`,
      };
    default:
      return {
        kind: "ready",
        title: "Scouting form builder",
        description:
          "Edit required fields, preview, and publish versioned match or pit schemas — never DEMO fields.",
      };
  }
}

/**
 * Soft-UI next actions for Form builder empty/setup shells.
 * Points at Scouting / Coverage — never invents DEMO fields.
 */
export function formBuilderNextActions(input: {
  orgId?: string | null;
  shell: FormBuilderShellKind;
  eventKey?: string | null;
  canManageSchemas?: boolean;
  entryType?: EntryType;
}): FormBuilderNextAction[] {
  const orgId = input.orgId ?? null;
  const typeLabel = input.entryType === "pit" ? "pit" : "match";

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Form builder is org-scoped — choose a team before publishing schemas.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Live entry stays blank until a real schema publishes — never DEMO fields.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
          href: withOrgHref("/scouting/lineup", null),
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Active event context lives on Event Day Command — never DEMO schedule.",
          href: hubHref("/competition", "command", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Event Day Command sets the season year match and pit forms publish under.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Confirm entry stays honest when the event is unset — never DEMO fields.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays honest when the event is unset — never DEMO %.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy waits on the same real event context — never DEMO win rates.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry form builder",
        detail: "Reload real schemas — nothing is pre-seeded while this fails.",
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while schemas reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays available while schemas reload.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "publish",
        label: input.canManageSchemas ? `Publish ${typeLabel} form` : "Ask an owner to publish",
        detail: input.canManageSchemas
          ? `Publish a real ${typeLabel} schema so Scouting and Coverage can use it — never DEMO fields.`
          : `Owners and admins publish ${typeLabel} forms — you can still preview the draft.`,
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Live entry stays blank until a published version exists.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Lineup gaps stay blank until real scout rows sync — never DEMO %.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  return [
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scouts pick up the published version on next sync.",
      href: hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "See which matches and teams still need scouts.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Synced notes deepen pick explainability — never DEMO win rates.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Confirm this device can cold-boot the published form when Wi-Fi drops.",
      href: withOrgHref("/offline", orgId),
    },
  ];
}

/** Soft-UI publish button label from draft vs published status. */
export function formBuilderPublishLabel(input: {
  busy?: boolean;
  entryType: EntryType;
  status: DraftPublishStatus;
}): string {
  if (input.busy) return "Publishing…";
  const typeLabel = input.entryType === "pit" ? "pit" : "match";
  if (input.status.kind === "unpublished") return `Publish ${typeLabel} form`;
  if (input.status.kind === "draft_changes") return `Publish ${typeLabel} changes`;
  return `Republish ${typeLabel} form`;
}

/**
 * Soft-UI publish clarity — why Publish is blocked right now.
 * Returns null when the draft is ready to POST.
 */
export function formBuilderPublishBlockedReason(input: {
  canManageSchemas: boolean;
  year: number | null | undefined;
  eventKey?: string | null;
  validation: FormBuilderValidation;
  acknowledgeBudget: boolean;
}): string | null {
  if (!input.canManageSchemas) {
    return "Owner or admin role is required to publish forms.";
  }
  if (!input.eventKey || input.year == null) {
    return "Set an active event so the season year is known before publishing.";
  }
  if (!input.validation.ok) {
    return input.validation.errors[0] ?? "Fix the form before publishing.";
  }
  if (input.validation.budget.status === "over_budget" && !input.acknowledgeBudget) {
    return "This form is over the field budget — acknowledge to publish anyway.";
  }
  return null;
}

export type FormBuilderValidation = {
  ok: boolean;
  errors: string[];
  budget: ReturnType<typeof lintSchemaBudget>;
  pitClaim: ReturnType<typeof lintPitClaimedScoring>;
};

/** Per-kind config checks for a studio question, phrased for a coach. */
export function studioQuestionErrors(question: DraftQuestion, position: number): string[] {
  const errors: string[] = [];
  const settings = question.settings ?? {};
  const n = position;
  if (question.kind === "counter" || question.kind === "multi_counter") {
    const steps = parseCounterSteps(settings.counterStepsText);
    if (!steps.length) errors.push(`Question ${n} needs at least one counter step (e.g. 1, 5, 10).`);
    const max = optionalWholeNumber(settings.maxText);
    if ((settings.maxText ?? "").trim() && max == null) {
      errors.push(`Question ${n} max must be a whole number, or blank for no cap.`);
    }
    if (max != null && max < 0 && !settings.allowNegative) {
      errors.push(`Question ${n} max cannot be negative unless negatives are allowed.`);
    }
    if (question.kind === "multi_counter" && parseSubCounters(settings.subCountersText).length < 1) {
      errors.push(`Question ${n} needs at least one named counter.`);
    }
  }
  if (question.kind === "rating") {
    const max = Number(settings.ratingMax ?? 5);
    if (!Number.isFinite(max) || max < RATING_MIN_STARS || max > RATING_MAX_STARS) {
      errors.push(`Question ${n} rating must top out between ${RATING_MIN_STARS} and ${RATING_MAX_STARS}.`);
    }
  }
  if (question.kind === "slider") {
    const min = Number(settings.sliderMin ?? 0);
    const max = Number(settings.sliderMax ?? 10);
    const step = Number(settings.sliderStep ?? 1);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      errors.push(`Question ${n} slider max must be greater than its min.`);
    } else if (!Number.isFinite(step) || step <= 0 || step > max - min) {
      errors.push(`Question ${n} slider step must be positive and no wider than the range.`);
    }
  }
  if (question.kind === "field_position") {
    const cols = Number(settings.gridCols ?? 6);
    const rows = Number(settings.gridRows ?? 3);
    const inRange = (value: number) =>
      Number.isFinite(value) && value >= FIELD_POSITION_MIN_GRID && value <= FIELD_POSITION_MAX_GRID;
    if (!inRange(cols) || !inRange(rows)) {
      errors.push(
        `Question ${n} field grid must be between ${FIELD_POSITION_MIN_GRID} and ${FIELD_POSITION_MAX_GRID} columns and rows.`,
      );
    }
  }
  if (question.kind === "section" && question.required) {
    errors.push(`Question ${n} is a section header — it cannot be required.`);
  }
  return errors;
}

/** Section headers group the fields that follow them (Auto | Teleop | Endgame). */
export type SchemaSection = { header: FieldDefinition | null; fields: FieldDefinition[] };

export function groupFieldsBySection(definition: SchemaDefinition): SchemaSection[] {
  const sections: SchemaSection[] = [];
  let current: SchemaSection = { header: null, fields: [] };
  for (const field of definition.fields) {
    if (isLayoutOnlyField(field)) {
      if (current.header || current.fields.length) sections.push(current);
      current = { header: field, fields: [] };
      continue;
    }
    current.fields.push(field);
  }
  if (current.header || current.fields.length) sections.push(current);
  return sections;
}

/**
 * Step a match key for the next entry ("qm12" → "qm13", "12" → "13").
 * Returns null when there is no trailing number to step, so the entry form
 * leaves the box alone rather than inventing a match that may not exist.
 */
export function nextMatchKey(matchKey: string): string | null {
  const match = /^(.*?)(\d+)$/.exec(matchKey.trim());
  if (!match) return null;
  const [, prefix = "", digits = ""] = match;
  const next = String(Number(digits) + 1);
  return `${prefix}${next.padStart(digits.length, "0")}`;
}

export function validateDraft(
  title: string,
  questions: DraftQuestion[],
  entryType: EntryType = "match",
): FormBuilderValidation {
  const errors: string[] = [];
  if (!title.trim()) errors.push("Give the form a title.");
  if (!questions.length) errors.push("Add at least one question.");
  const labels = new Set<string>();
  for (const [index, question] of questions.entries()) {
    const n = index + 1;
    if (!question.label.trim()) errors.push(`Question ${n} needs a label.`);
    if (isScoutIdentityField({ key: question.label, label: question.label })) {
      errors.push(
        `Question ${n} (“${question.label.trim()}”) is a free-text scout identity field — identity locks to membership userId.`,
      );
    }
    const labelKey = question.label.trim().toLowerCase();
    if (labelKey && labels.has(labelKey)) {
      errors.push(`Duplicate label: “${question.label.trim()}”.`);
    }
    if (labelKey) labels.add(labelKey);
    if (question.kind === "mc" || question.kind === "dropdown" || question.kind === "multi_select") {
      const options = parseOptions(question.optionsText);
      if (options.length < 2) {
        errors.push(`Question ${n} needs at least two options.`);
      }
    }
    errors.push(...studioQuestionErrors(question, n));
  }
  const definition = definitionFromDraft(title, questions);
  const identityError = assertSchemaIdentityLock(definition);
  if (identityError) errors.push(identityError);
  // Section headers are layout, not questions — they must not eat the accuracy
  // budget that CD keeps telling teams to spend on fewer real fields.
  const budget = lintSchemaBudget({
    title: definition.title,
    fields: answerableFields(definition),
  });
  const pitClaim =
    entryType === "pit"
      ? lintPitClaimedScoring(definition)
      : { status: "ok" as const, flagged: [], message: "" };
  return { ok: errors.length === 0, errors, budget, pitClaim };
}
