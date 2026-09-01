/**
 * List assembly instance ids from GET assemblies (getOnshapeAssembly).
 * Walks rootAssembly.instances / instances only — no FeatureScript, no invented DEMO ids.
 */

import { getOnshapeAssembly, type OnshapeAssemblyRef, type OnshapeNativeHttp } from "./onshape-assemblies";

export type OnshapeAssemblyInstance = {
  id: string;
  name: string;
};

const DEMO_INSTANCE_ID = /demo/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readInstanceId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!id) return "";
  if (DEMO_INSTANCE_ID.test(id)) {
    throw new Error("Refusing DEMO instance id. Use an id Onshape returned from getOnshapeAssembly.");
  }
  return id;
}

function collectInstanceRows(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];
  const rows: unknown[] = [];
  const rootAssembly = asRecord(root.rootAssembly);
  if (rootAssembly && Array.isArray(rootAssembly.instances)) {
    rows.push(...rootAssembly.instances);
  }
  if (Array.isArray(root.instances)) {
    rows.push(...root.instances);
  }
  return rows;
}

/**
 * Keep `{ id, name }` only when id is a non-empty non-DEMO string.
 * Empty / missing payload → [].
 */
export function parseOnshapeAssemblyInstances(payload: unknown): OnshapeAssemblyInstance[] {
  const rows: OnshapeAssemblyInstance[] = [];
  const seen = new Set<string>();
  for (const item of collectInstanceRows(payload)) {
    const record = asRecord(item);
    const id = readInstanceId(record?.id ?? record?.instanceId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ id, name: String(record?.name ?? "").trim() });
  }
  return rows;
}

export async function listOnshapeAssemblyInstances(
  http: OnshapeNativeHttp,
  ref: OnshapeAssemblyRef,
): Promise<OnshapeAssemblyInstance[]> {
  return parseOnshapeAssemblyInstances(await getOnshapeAssembly(http, ref));
}
