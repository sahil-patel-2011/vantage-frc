/**
 * Lovat Collection rule: only show the actions this robot can do *now*.
 * A field stays hidden until its `visibleWhen` rule is satisfied by real
 * answers already on the form. Missing answers never invent a match.
 */

export type VisibleWhenClause = {
  fieldKey: string;
  equals?: unknown;
  notEquals?: unknown;
  isTrue?: boolean;
  isSet?: boolean;
  /** Inclusive numeric floor when the watched field is a finite number. */
  gte?: number;
  /** Inclusive numeric ceiling when the watched field is a finite number. */
  lte?: number;
  /** Watched field is one of these (string or number). */
  oneOf?: Array<string | number | boolean>;
};

export type VisibleWhen = VisibleWhenClause | { allOf: VisibleWhenClause[] } | { anyOf: VisibleWhenClause[] };

export type VisibleField = {
  key: string;
  visibleWhen?: VisibleWhen | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSet(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return false;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function clauseMatches(clause: VisibleWhenClause, payload: Record<string, unknown>): boolean {
  const watched = payload[clause.fieldKey];
  if (clause.isSet === true && !isSet(watched)) return false;
  if (clause.isSet === false && isSet(watched)) return false;
  if (clause.isTrue === true && watched !== true) return false;
  if (clause.isTrue === false && watched !== false) return false;
  if ("equals" in clause && clause.equals !== undefined) {
    if (watched !== clause.equals) return false;
  }
  if ("notEquals" in clause && clause.notEquals !== undefined) {
    if (watched === clause.notEquals) return false;
  }
  if (clause.gte != null) {
    const number = asNumber(watched);
    if (number == null || number < clause.gte) return false;
  }
  if (clause.lte != null) {
    const number = asNumber(watched);
    if (number == null || number > clause.lte) return false;
  }
  if (clause.oneOf) {
    if (!clause.oneOf.some((option) => option === watched)) return false;
  }
  return true;
}

export function visibleWhenMatches(rule: VisibleWhen | null | undefined, payload: Record<string, unknown>): boolean {
  if (rule == null) return true;
  if ("allOf" in rule) {
    if (!Array.isArray(rule.allOf) || rule.allOf.length === 0) return true;
    return rule.allOf.every((clause) => clauseMatches(clause, payload));
  }
  if ("anyOf" in rule) {
    if (!Array.isArray(rule.anyOf) || rule.anyOf.length === 0) return true;
    return rule.anyOf.some((clause) => clauseMatches(clause, payload));
  }
  return clauseMatches(rule, payload);
}

export function readVisibleWhen(field: { config?: Record<string, unknown> | null; visibleWhen?: unknown }): VisibleWhen | null {
  const raw = field.visibleWhen ?? field.config?.visibleWhen;
  if (raw == null) return null;
  if (isPlainObject(raw) && ("allOf" in raw || "anyOf" in raw || "fieldKey" in raw)) {
    return raw as VisibleWhen;
  }
  return null;
}

/**
 * Fields the scout should see right now. Layout-only fields (section headers)
 * stay visible so the form does not jump; answers stay gated.
 */
export function visibleFields<T extends VisibleField & { type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
  payload: Record<string, unknown>,
): T[] {
  return fields.filter((field) => {
    if (field.type === "section_header") return true;
    return visibleWhenMatches(readVisibleWhen(field), payload);
  });
}

/** Hidden answer keys that should not leak into a save after the form gated them off. */
export function hiddenAnswerKeys<T extends VisibleField & { type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
  payload: Record<string, unknown>,
): string[] {
  const shown = new Set(visibleFields(fields, payload).map((field) => field.key));
  return fields.filter((field) => field.type !== "section_header" && !shown.has(field.key)).map((field) => field.key);
}

export function stripHiddenAnswers<T extends VisibleField & { type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const hidden = new Set(hiddenAnswerKeys(fields, payload));
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (hidden.has(key)) continue;
    next[key] = value;
  }
  return next;
}

/**
 * Typical Lovat match-flow rules: auto questions while the phase is auto,
 * teleop after auto ends, endgame once teleop is underway.
 */
export function defaultMatchPhaseRules(): Record<string, VisibleWhen> {
  return {
    auto: { anyOf: [{ fieldKey: "gamePhase", equals: "auto" }, { fieldKey: "gamePhase", isSet: false }] },
    teleop: { fieldKey: "gamePhase", oneOf: ["teleop", "endgame"] },
    endgame: { fieldKey: "gamePhase", equals: "endgame" },
    defense: { anyOf: [{ fieldKey: "playingDefense", isTrue: true }, { fieldKey: "defense", isTrue: true }] },
    climb: { anyOf: [{ fieldKey: "gamePhase", equals: "endgame" }, { fieldKey: "attemptedClimb", isTrue: true }] },
  };
}

export function applyPhaseRules<T extends VisibleField & { key: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
  rules: Record<string, VisibleWhen> = defaultMatchPhaseRules(),
): T[] {
  return fields.map((field) => {
    const rule = rules[field.key];
    if (!rule) return field;
    const config = { ...(field.config ?? {}), visibleWhen: rule };
    return { ...field, config };
  });
}

export type InferredPhase = "auto" | "teleop" | "endgame" | "defense" | "climb";

/** Guess the match phase from a community field key — never invents a score. */
export function inferPhaseFromKey(key: string): InferredPhase | null {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (!normalized) return null;
  if (normalized === "gamephase" || normalized === "phase") return null;
  if (normalized.includes("defense") || normalized.includes("defend") || normalized.includes("defendtime")) {
    return "defense";
  }
  if (normalized.includes("climb") || normalized.includes("tower") || normalized.includes("endgame")) {
    return "endgame";
  }
  if (normalized.startsWith("auto") || normalized.includes("auton")) return "auto";
  if (normalized.startsWith("tele") || normalized.includes("teleop")) return "teleop";
  return null;
}

export function ensureGamePhaseField<T extends { key: string }>(fields: readonly T[]): T[] {
  if (fields.some((field) => field.key === "gamePhase" || field.key === "game_phase")) return [...fields];
  const phase = {
    key: "gamePhase",
    label: "Match phase",
    type: "select",
    options: ["auto", "teleop", "endgame"],
  } as unknown as T;
  return [phase, ...fields];
}

/**
 * Apply Lovat-style phase gates from field keys when the form author did not
 * write `visibleWhen`. Existing rules win.
 */
export function withInferredPhaseRules<T extends VisibleField & { key: string; type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
): T[] {
  const withPhase = ensureGamePhaseField(fields);
  const rules = defaultMatchPhaseRules();
  return withPhase.map((field) => {
    if (readVisibleWhen(field)) return field;
    const phase = inferPhaseFromKey(field.key);
    if (!phase) return field;
    const rule = rules[phase];
    if (!rule) return field;
    return { ...field, config: { ...(field.config ?? {}), visibleWhen: rule } };
  });
}
