/**
 * Conditional questions depend on actual answers.
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

const scalar = (value: unknown) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
function isClause(value: unknown): value is VisibleWhenClause {
  if (!isPlainObject(value) || typeof value.fieldKey !== "string" || !value.fieldKey.trim() || value.fieldKey.length > 200) return false;
  const tests = Object.keys(value).filter(key => key !== "fieldKey" && value[key] !== undefined);
  return tests.length > 0 && tests.every(key => {
    if (key === "equals" || key === "notEquals") return scalar(value[key]);
    if (key === "isTrue" || key === "isSet") return typeof value[key] === "boolean";
    if (key === "gte" || key === "lte") return typeof value[key] === "number" && Number.isFinite(value[key]);
    if (key === "oneOf") return Array.isArray(value[key]) && value[key].length > 0 && value[key].length <= 200 && value[key].every(option => option !== null && scalar(option));
    return false;
  });
}

/** Validate persisted/custom rules before either the entry UI or server uses them. */
export function isVisibleWhen(value: unknown): value is VisibleWhen {
  if (!isPlainObject(value)) return false;
  if ("allOf" in value || "anyOf" in value) {
    const key = "allOf" in value ? "allOf" : "anyOf";
    const clauses = value[key];
    return Object.keys(value).length === 1 && Array.isArray(clauses) && clauses.length > 0 && clauses.length <= 64 && clauses.every(isClause);
  }
  return isClause(value);
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
  if (!isClause(clause)) return false;
  const watched = payload[clause.fieldKey];
  if (clause.isSet === true && !isSet(watched)) return false;
  if (clause.isSet === false && isSet(watched)) return false;
  if (clause.isTrue === true && watched !== true) return false;
  if (clause.isTrue === false && watched !== false) return false;
  if ("equals" in clause && clause.equals !== undefined) {
    if (watched !== clause.equals) return false;
  }
  if ("notEquals" in clause && clause.notEquals !== undefined) {
    if (!isSet(watched) || watched === clause.notEquals) return false;
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
  if (!isVisibleWhen(rule)) return false;
  if ("allOf" in rule) {
    return rule.allOf.every((clause) => clauseMatches(clause, payload));
  }
  if ("anyOf" in rule) {
    return rule.anyOf.some((clause) => clauseMatches(clause, payload));
  }
  return clauseMatches(rule, payload);
}

export function readVisibleWhen(field: { config?: Record<string, unknown> | null; visibleWhen?: unknown }): VisibleWhen | null {
  const raw = field.visibleWhen ?? field.config?.visibleWhen;
  if (raw == null) return null;
  // A malformed persisted rule cannot crash entry or silently become unconditional.
  // New malformed rules are rejected at publication; old ones remain closed.
  return raw as VisibleWhen;
}

/** Cyclic conditions can leave a whole section impossible to answer. */
export function cyclicVisibilityKeys(fields: readonly { key: string; config?: Record<string, unknown> | null; visibleWhen?: unknown }[]): string[] {
  const dependencies = new Map(fields.map(field => {
    const rule = readVisibleWhen(field);
    const clauses = rule && isVisibleWhen(rule) ? "allOf" in rule ? rule.allOf : "anyOf" in rule ? rule.anyOf : [rule] : [];
    return [field.key, clauses.map(clause => clause.fieldKey)] as const;
  }));
  const done = new Set<string>();
  const path: string[] = [];
  const cycles = new Set<string>();
  const visit = (key: string) => {
    const at = path.indexOf(key);
    if (at >= 0) { path.slice(at).forEach(item => cycles.add(item)); return; }
    if (done.has(key) || !dependencies.has(key)) return;
    path.push(key);
    for (const dependency of dependencies.get(key)!) visit(dependency);
    path.pop(); done.add(key);
  };
  for (const key of dependencies.keys()) visit(key);
  return [...cycles];
}

/**
 * Fields the scout should see right now. Layout-only fields (section headers)
 * stay visible so the form does not jump; answers stay gated.
 */
export function visibleFields<T extends VisibleField & { type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
  payload: Record<string, unknown>,
): T[] {
  const byKey = new Map(fields.map(field => [field.key, field]));
  const resolved = new Map<string, boolean>();
  const cyclic = new Set(cyclicVisibilityKeys(fields));
  const shown = (key: string): boolean => {
    if (resolved.has(key)) return resolved.get(key)!;
    const field = byKey.get(key);
    if (!field) return true;
    if (field.type === "section_header") return true;
    if (cyclic.has(key)) return false;
    const rule = readVisibleWhen(field);
    if (rule == null) return true;
    if (!isVisibleWhen(rule)) return false;
    // A stale answer on a hidden controller cannot reveal its dependants.
    // anyOf still permits a different, visible controller to satisfy the rule.
    const matches = (clause: VisibleWhenClause) => shown(clause.fieldKey) && clauseMatches(clause, payload);
    const visible = "allOf" in rule ? rule.allOf.every(matches) : "anyOf" in rule ? rule.anyOf.some(matches) : matches(rule);
    resolved.set(key, visible);
    return visible;
  };
  return fields.filter(field => shown(field.key));
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
 * Typical match-flow rules: auto questions while the phase is auto,
 * teleop after auto ends, endgame once teleop is underway.
 */
export function defaultMatchPhaseRules(phaseField = "gamePhase"): Record<string, VisibleWhen> {
  return {
    auto: { anyOf: [{ fieldKey: phaseField, equals: "auto" }, { fieldKey: phaseField, isSet: false }] },
    teleop: { fieldKey: phaseField, oneOf: ["teleop", "endgame"] },
    endgame: { fieldKey: phaseField, equals: "endgame" },
    defense: { anyOf: [{ fieldKey: "playingDefense", isTrue: true }, { fieldKey: "defense", isTrue: true }] },
    climb: { anyOf: [{ fieldKey: phaseField, equals: "endgame" }, { fieldKey: "attemptedClimb", isTrue: true }] },
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
  if (["gamephase", "phase", "playingdefense", "defense"].includes(normalized)) return null;
  if (normalized.startsWith("auto") || normalized.includes("auton")) return "auto";
  if (normalized.includes("defense") || normalized.includes("defend") || normalized.includes("defendtime")) {
    return "defense";
  }
  if (normalized.includes("climb") || normalized.includes("tower") || normalized.includes("endgame")) {
    return "endgame";
  }
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
 * Apply phase gates from field keys when the form author did not
 * write `visibleWhen`. Existing rules win.
 *
 * A summary form — the season starter, with auto and teleop counts on one
 * entry — does not include a phase control. Inventing one and hiding the
 * teleop count made that required answer unreachable. Gates apply only when
 * the author already asked which phase this entry is.
 */
export function withInferredPhaseRules<T extends VisibleField & { key: string; type?: string; config?: Record<string, unknown> | null }>(
  fields: readonly T[],
): T[] {
  const phaseField = fields.find((field) => field.key === "gamePhase" || field.key === "game_phase")?.key;
  if (!phaseField) return [...fields];
  const rules = defaultMatchPhaseRules(phaseField);
  return fields.map((field) => {
    if (field.visibleWhen != null || field.config?.visibleWhen != null) return field;
    const configured = field.config?.scoutPhase;
    const phase = configured === "auto" || configured === "teleop" || configured === "endgame" ? configured : inferPhaseFromKey(field.key);
    if (!phase) return field;
    let rule = rules[phase];
    if (!rule) return field;
    if (phase === "defense") {
      const controllers = ["playingDefense", "defense"].filter(key => fields.some(candidate => candidate.key === key));
      if (!controllers.length) return field;
      rule = { anyOf: controllers.map(fieldKey => ({ fieldKey, isTrue: true })) };
    }
    return { ...field, config: { ...(field.config ?? {}), visibleWhen: rule } };
  });
}
