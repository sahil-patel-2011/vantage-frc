/**
 * Apply the publish-time form→engine map before strategy blends scout ops.
 *
 * prediction-strategy still reads autoScore / teleop / endgame (and its own
 * role ladder). This wrapper projects mapped custom form keys onto those
 * engine names so the blender sees them. Unmapped keys stay off the engine
 * keys (`null`) — pEPA is skipped, never invented.
 */

import type { ScoutFieldRoleMap, StrategyFieldRole } from "@vantage/prediction-strategy";
import {
  FORM_ENGINE_KEYS,
  projectEnginePayload,
  resolveFormEngineScores,
  type FormEngineKey,
  type FormEngineMap,
  type FormEngineScores,
} from "../scouting/form-engine-map";

const ROLE_TO_ENGINE: Partial<Record<StrategyFieldRole, FormEngineKey>> = {
  auto_score: "autoScore",
  teleop_score: "teleop",
  endgame: "endgame",
};

/** Roles / maps the strategy path already has — or a publish-time FormEngineMap. */
export type ScoutEngineMapInput =
  | FormEngineMap
  | Record<string, FormEngineKey>
  | ScoutFieldRoleMap
  | null
  | undefined;

function isFormEngineKey(value: string): value is FormEngineKey {
  return (FORM_ENGINE_KEYS as readonly string[]).includes(value);
}

/** Scoring roles → engine keys. `none` / defense / fouls / notes stay unbound. */
export function engineBindingsFromRoles(
  roles: ScoutFieldRoleMap | Record<string, string> | null | undefined,
): Record<string, FormEngineKey> {
  const bindings: Record<string, FormEngineKey> = {};
  if (!roles) return bindings;
  for (const [formKey, value] of Object.entries(roles)) {
    if (isFormEngineKey(value)) {
      bindings[formKey] = value;
      continue;
    }
    const engineKey = ROLE_TO_ENGINE[value as StrategyFieldRole];
    if (engineKey) bindings[formKey] = engineKey;
  }
  return bindings;
}

function isFormEngineMap(map: object): map is FormEngineMap {
  return (
    "bindings" in map &&
    "byEngine" in map &&
    "unmapped" in map &&
    "fields" in map &&
    Boolean((map as FormEngineMap).bindings) &&
    typeof (map as FormEngineMap).bindings === "object"
  );
}

function asEngineMap(
  map: ScoutEngineMapInput,
): FormEngineMap | Record<string, FormEngineKey> {
  if (!map) return {};
  if (isFormEngineMap(map)) return map;
  return engineBindingsFromRoles(map as Record<string, string>);
}

/** Engine component scores. Unmapped / missing / non-numeric stay `null`, never `0`. */
export function resolveScoutEngineScores(
  payload: Record<string, unknown> | null | undefined,
  map: ScoutEngineMapInput,
): FormEngineScores {
  return resolveFormEngineScores(payload, asEngineMap(map));
}

/**
 * Copy resolved engine keys onto a scout payload. Only writes a key when the
 * map produced a number. Does not invent autoScore / teleop / endgame from
 * unbound form fields.
 */
export function projectScoutEnginePayload(
  payload: Record<string, unknown> | null | undefined,
  map: ScoutEngineMapInput,
): Record<string, unknown> {
  return projectEnginePayload(payload, asEngineMap(map));
}

/** Project every entry payload before `buildOperationsFromScoutEntries`. */
export function projectScoutEntriesForEngine<T extends { payload: Record<string, unknown> }>(
  entries: T[],
  map: ScoutEngineMapInput,
): T[] {
  return entries.map((entry) => ({
    ...entry,
    payload: projectScoutEnginePayload(entry.payload, map),
  }));
}
