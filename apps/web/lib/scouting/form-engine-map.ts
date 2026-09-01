/**
 * Publish-time map: custom form keys → pEPA engine keys.
 *
 * The private-EPA blender reads autoScore / teleop / endgame. Form builder
 * slugifies labels (`cargo_high`, `speaker_notes`), so a published custom form
 * can collect a season of answers and still hand the engine `null` for every
 * component — pEPA is then skipped, not invented.
 *
 * This module is the bind that publish should persist and consumers should
 * apply. It uses the same `config.role` + key-inference ladder the form builder
 * already writes. Unmapped keys stay unmapped. Missing answers stay `null`.
 * Nothing here guesses a score from an unbound field.
 */

import type { SchemaDefinition } from "@vantage/scouting";
import {
  inferRoleForFieldKey,
  isStrategyFieldRole,
  type StrategyFieldRole,
} from "@vantage/prediction-strategy";

/** The three component keys the pEPA engine actually blends. */
export const FORM_ENGINE_KEYS = ["autoScore", "teleop", "endgame"] as const;
export type FormEngineKey = (typeof FORM_ENGINE_KEYS)[number];

/** Builder / strategy roles that bind to an engine key. Others never do. */
const ROLE_TO_ENGINE: Partial<Record<StrategyFieldRole, FormEngineKey>> = {
  auto_score: "autoScore",
  teleop_score: "teleop",
  endgame: "endgame",
};

/**
 * Exact/normalized aliases of the engine keys themselves. A form that already
 * ships `autoScore` or `teleop_score` binds without a coach having to re-pick
 * a role. Broader convention names (`cycles`, `climb`) stay unbound unless the
 * published field declares a role — we do not invent that bind.
 */
const ENGINE_KEY_ALIASES: Record<FormEngineKey, readonly string[]> = {
  autoScore: ["autoScore", "auto_score", "autoPoints", "auto_points"],
  teleop: ["teleop", "teleopScore", "teleop_score", "teleopPoints", "teleop_points"],
  endgame: ["endgame", "endgameScore", "endgame_score", "endgamePoints", "endgame_points"],
};

const ENGINE_ALIAS_NORMS = (() => {
  const norms = new Map<string, FormEngineKey>();
  for (const engineKey of FORM_ENGINE_KEYS) {
    for (const alias of ENGINE_KEY_ALIASES[engineKey]) {
      norms.set(normalizeFormKey(alias), engineKey);
    }
  }
  return norms;
})();

export type FormEngineBindSource = "role" | "convention";

export type FormEngineBinding = {
  formKey: string;
  engineKey: FormEngineKey;
  source: FormEngineBindSource;
};

export type FormEngineMap = {
  /** formKey → engineKey. Only keys that actually bind. */
  bindings: Record<string, FormEngineKey>;
  /** Engine key → form keys that feed it, in form order. */
  byEngine: Record<FormEngineKey, string[]>;
  /** Answerable form keys with no engine bind. */
  unmapped: string[];
  /** Per-field bind records (mapped fields only). */
  fields: FormEngineBinding[];
};

export type FormEngineScores = {
  autoScore: number | null;
  teleop: number | null;
  endgame: number | null;
};

export type FormEngineGap = {
  engineKey: FormEngineKey;
  /** True when no published question binds to this engine key. */
  missing: boolean;
};

type LooseField = {
  key?: unknown;
  type?: unknown;
  config?: unknown;
};

type LooseDefinition = {
  fields?: Array<LooseField | null | undefined> | null;
} | null;

function normalizeFormKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emptyByEngine(): Record<FormEngineKey, string[]> {
  return { autoScore: [], teleop: [], endgame: [] };
}

function emptyMap(): FormEngineMap {
  return { bindings: {}, byEngine: emptyByEngine(), unmapped: [], fields: [] };
}

function emptyScores(): FormEngineScores {
  return { autoScore: null, teleop: null, endgame: null };
}

function fieldsOf(definition: LooseDefinition): LooseField[] {
  const fields = definition?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.filter((field): field is LooseField => Boolean(field) && typeof field === "object");
}

function configuredRole(field: LooseField): StrategyFieldRole | null {
  const role = (field.config as { role?: unknown } | null | undefined)?.role;
  return isStrategyFieldRole(role) ? role : null;
}

const LAYOUT_ONLY_TYPES = new Set(["section_header", "section"]);

function isLayout(field: LooseField): boolean {
  return typeof field.type === "string" && LAYOUT_ONLY_TYPES.has(field.type);
}

/**
 * Resolve one published field to an engine key, or null if it stays unbound.
 * Explicit `config.role` wins — including `"none"` opt-out. Convention aliases
 * of autoScore/teleop/endgame bind next. Key-inference (`auto_*` → auto) is
 * last, and only for the three scoring roles.
 */
export function engineKeyForField(field: LooseField): FormEngineBinding | null {
  if (typeof field.key !== "string" || !field.key.trim()) return null;
  if (isLayout(field)) return null;
  const formKey = field.key;
  const configured = configuredRole(field);
  if (configured === "none") return null;
  if (configured) {
    const engineKey = ROLE_TO_ENGINE[configured];
    return engineKey ? { formKey, engineKey, source: "role" } : null;
  }
  const aliased = ENGINE_ALIAS_NORMS.get(normalizeFormKey(formKey));
  if (aliased) return { formKey, engineKey: aliased, source: "convention" };
  const inferred = inferRoleForFieldKey(formKey);
  const engineKey = ROLE_TO_ENGINE[inferred];
  return engineKey ? { formKey, engineKey, source: "convention" } : null;
}

/**
 * Build the publish-time map from a schema definition (or any `{ fields }` bag).
 * Safe on null / empty / pre-publish drafts — those produce an empty map, never
 * invented binds.
 */
export function buildFormEngineMap(definition: LooseDefinition | SchemaDefinition | undefined): FormEngineMap {
  const map = emptyMap();
  const seen = new Set<string>();
  for (const field of fieldsOf(definition ?? null)) {
    if (typeof field.key !== "string" || !field.key.trim()) continue;
    if (isLayout(field)) continue;
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    const bind = engineKeyForField(field);
    if (!bind) {
      map.unmapped.push(field.key);
      continue;
    }
    map.bindings[bind.formKey] = bind.engineKey;
    map.byEngine[bind.engineKey].push(bind.formKey);
    map.fields.push(bind);
  }
  return map;
}

/** Engine keys that have no published form field bound to them. */
export function missingFormEngineKeys(map: FormEngineMap): FormEngineKey[] {
  return FORM_ENGINE_KEYS.filter((key) => map.byEngine[key].length === 0);
}

/** Publish-confirm rows: each engine key and whether it is still unbound. */
export function formEngineGaps(map: FormEngineMap): FormEngineGap[] {
  return FORM_ENGINE_KEYS.map((engineKey) => ({
    engineKey,
    missing: map.byEngine[engineKey].length === 0,
  }));
}

function numericAnswer(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBindings(
  map: FormEngineMap | Record<string, FormEngineKey> | null | undefined,
): Record<string, FormEngineKey> {
  if (!map) return {};
  if ("bindings" in map && map.bindings && typeof map.bindings === "object") {
    return map.bindings;
  }
  return map as Record<string, FormEngineKey>;
}

/**
 * Project a scout payload onto the three engine keys using a publish-time map.
 *
 * - Only mapped form keys contribute.
 * - Several form keys bound to one engine key are summed (they were published
 *   as contributing to that period).
 * - A mapped field with no numeric answer is skipped.
 * - If every mapped field is missing or non-numeric, that engine key is `null`
 *   — never `0`. Zero is only returned when a scout actually entered 0.
 * - Unmapped payload keys are ignored even when they look like scores.
 */
export function resolveFormEngineScores(
  payload: Record<string, unknown> | null | undefined,
  map: FormEngineMap | Record<string, FormEngineKey> | null | undefined,
): FormEngineScores {
  const scores = emptyScores();
  const bindings = asBindings(map);
  if (!payload || typeof payload !== "object") return scores;
  const boundKeys = Object.keys(bindings);
  if (!boundKeys.length) return scores;

  const sums: Record<FormEngineKey, { total: number; count: number }> = {
    autoScore: { total: 0, count: 0 },
    teleop: { total: 0, count: 0 },
    endgame: { total: 0, count: 0 },
  };
  for (const formKey of boundKeys) {
    const engineKey = bindings[formKey];
    if (!engineKey || !(engineKey in sums)) continue;
    if (!(formKey in payload)) continue;
    const value = numericAnswer(payload[formKey]);
    if (value == null) continue;
    sums[engineKey].total += value;
    sums[engineKey].count += 1;
  }
  for (const engineKey of FORM_ENGINE_KEYS) {
    scores[engineKey] = sums[engineKey].count ? sums[engineKey].total : null;
  }
  return scores;
}

/**
 * Copy engine keys onto a payload for consumers that still read autoScore /
 * teleop / endgame by name. Only writes a key when the map resolved a number.
 * Never writes `0` or `null` for an unbound / unanswered engine key.
 */
export function projectEnginePayload(
  payload: Record<string, unknown> | null | undefined,
  map: FormEngineMap | Record<string, FormEngineKey> | null | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = payload && typeof payload === "object" ? { ...payload } : {};
  const scores = resolveFormEngineScores(payload, map);
  for (const engineKey of FORM_ENGINE_KEYS) {
    if (scores[engineKey] != null) next[engineKey] = scores[engineKey];
  }
  return next;
}
