/**
 * Planned weight-budget lines (`weight_components`) — application-level upsert.
 *
 * The table has no unique constraint, so create-only INSERT duplicates the same
 * name + subsystem. This helper updates in place when the identity matches.
 * Scale / weigh-in / `robot_weights` are out of scope; this never invents a
 * DEMO or default planned lb.
 */

import type { PoolClient } from "@neondatabase/serverless";
import {
  parseWeightAction,
  validateComponent,
  type ComponentInput,
  type WeightAction,
} from "../weight-budget";

export type PlannedLineIdentity = {
  orgId: string;
  seasonYear: number;
  name: string;
  subsystem: string;
};

export type ExistingPlannedLineRef = PlannedLineIdentity & { id: string };

export type PlannedLineWrite = { kind: "insert" } | { kind: "update"; id: string; reason: "id" | "identity" };

export type PlannedLineSaveInput = PlannedLineIdentity &
  ComponentInput & {
    createdBy: string;
    id?: string | null;
  };

export type PlannedLineUpsertResult = { id: string; wrote: "insert" | "update" };

export type WeightWriteAction =
  | ({ action: "create_component" | "upsert_component"; orgId: string; seasonYear: number; id?: string } & ComponentInput)
  | Extract<WeightAction, { action: "update_component" | "delete_component" | "set_limit" }>;

function normalizePart(value: string): string {
  return value.trim().toLowerCase();
}

function optionalId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const id = (raw as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.trim()) return undefined;
  return id.trim();
}

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

/** Stable key for "this is the same planned line" — org + season + name + subsystem. */
export function plannedLineIdentityKey(row: PlannedLineIdentity): string {
  return [row.orgId, String(row.seasonYear), normalizePart(row.name), normalizePart(row.subsystem)].join("\0");
}

/**
 * Decide insert vs in-place update without touching the database.
 *
 * An explicit `id` that belongs to the same org wins (rename stays on the same row).
 * Otherwise the natural key (org, season, name, subsystem) updates the existing row
 * so saving "Swerve module / Drivetrain" a second time does not duplicate-insert.
 */
export function resolvePlannedLineWrite(
  incoming: PlannedLineIdentity & { id?: string | null },
  existing: ExistingPlannedLineRef[],
): PlannedLineWrite {
  const incomingId = incoming.id?.trim() || null;
  if (incomingId) {
    const byId = existing.find((row) => row.id === incomingId && row.orgId === incoming.orgId);
    if (byId) return { kind: "update", id: byId.id, reason: "id" };
  }

  const key = plannedLineIdentityKey(incoming);
  const byIdentity = existing.find((row) => plannedLineIdentityKey(row) === key);
  if (byIdentity) return { kind: "update", id: byIdentity.id, reason: "identity" };
  return { kind: "insert" };
}

function parseUpsertComponent(raw: unknown): Extract<WeightWriteAction, { action: "upsert_component" }> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const validated = validateComponent(body);
  if (!validated.ok) throw new Error(validated.error);
  const seasonYear = Number(body.seasonYear);
  if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
  const parsed: Extract<WeightWriteAction, { action: "upsert_component" }> = {
    action: "upsert_component",
    orgId: reqStr(body.orgId, "orgId"),
    seasonYear,
    ...validated.value,
  };
  const id = optionalId(raw);
  if (id) parsed.id = id;
  return parsed;
}

/**
 * Accepts `upsert_component` plus the existing create/update/delete/set_limit body.
 * `create_component` may carry an optional `id` so a rename updates the same row.
 */
export function parseWeightWrite(raw: unknown): WeightWriteAction {
  if (raw && typeof raw === "object" && (raw as { action?: unknown }).action === "upsert_component") {
    return parseUpsertComponent(raw);
  }

  const action = parseWeightAction(raw);
  if (action.action !== "create_component") return action;
  const id = optionalId(raw);
  return id ? { ...action, id } : action;
}

export function plannedLineSaveFromWrite(
  action: Extract<WeightWriteAction, { action: "create_component" | "upsert_component" | "update_component" }>,
  createdBy: string,
): PlannedLineSaveInput {
  if (action.action === "update_component") {
    return {
      orgId: action.orgId,
      seasonYear: 0,
      createdBy,
      id: action.id,
      ...action.patch,
    };
  }
  return {
    orgId: action.orgId,
    seasonYear: action.seasonYear,
    createdBy,
    id: action.id,
    name: action.name,
    subsystem: action.subsystem,
    weightLbs: action.weightLbs,
    quantity: action.quantity,
    notes: action.notes,
  };
}

type PlannedLineLookupRow = ExistingPlannedLineRef;

async function loadWriteCandidates(client: PoolClient, input: PlannedLineSaveInput): Promise<PlannedLineLookupRow[]> {
  const found: PlannedLineLookupRow[] = [];

  if (input.id?.trim()) {
    const byId = await client.query<PlannedLineLookupRow>(
      `SELECT id, org_id::text AS "orgId", season_year AS "seasonYear", name, subsystem
       FROM weight_components
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.id.trim(), input.orgId],
    );
    found.push(...byId.rows);
  }

  if (Number.isInteger(input.seasonYear) && input.seasonYear > 0) {
    const byIdentity = await client.query<PlannedLineLookupRow>(
      `SELECT id, org_id::text AS "orgId", season_year AS "seasonYear", name, subsystem
       FROM weight_components
       WHERE org_id = $1::uuid
         AND season_year = $2
         AND lower(name) = lower($3)
         AND lower(subsystem) = lower($4)
       LIMIT 1`,
      [input.orgId, input.seasonYear, input.name, input.subsystem],
    );
    for (const row of byIdentity.rows) {
      if (!found.some((existing) => existing.id === row.id)) found.push(row);
    }
  }

  return found;
}

/**
 * Persist a planned line. Same org + season + name + subsystem updates the
 * existing row; a new identity inserts. Never writes `robot_weights` or a
 * weigh-in scale reading, and never fills in a DEMO / default lb.
 */
export async function upsertPlannedLine(
  client: PoolClient,
  input: PlannedLineSaveInput,
): Promise<PlannedLineUpsertResult> {
  const write = resolvePlannedLineWrite(input, await loadWriteCandidates(client, input));

  if (write.kind === "update") {
    const updated = await client.query<{ id: string }>(
      `UPDATE weight_components
       SET name = $1, subsystem = $2, weight_lbs = $3, quantity = $4, notes = $5, updated_at = now()
       WHERE id = $6::uuid AND org_id = $7::uuid
       RETURNING id`,
      [input.name, input.subsystem, input.weightLbs, input.quantity, input.notes, write.id, input.orgId],
    );
    const id = updated.rows[0]?.id;
    if (!id) throw new Error("Component not found");
    return { id, wrote: "update" };
  }

  if (!Number.isInteger(input.seasonYear) || input.seasonYear <= 0) {
    throw new Error("Component not found");
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO weight_components (org_id, season_year, name, subsystem, weight_lbs, quantity, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.orgId, input.seasonYear, input.name, input.subsystem, input.weightLbs, input.quantity, input.notes, input.createdBy],
  );
  return { id: inserted.rows[0]!.id, wrote: "insert" };
}
