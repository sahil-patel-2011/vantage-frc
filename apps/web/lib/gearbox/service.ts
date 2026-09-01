import type { PoolClient } from "@neondatabase/serverless";
import type { Stage } from "../gearbox";
import {
  gearboxWriteFromUniqueViolation,
  resolveGearboxWrite,
  type ExistingGearboxRef,
} from "./upsert";

export type GearboxSaveInput = {
  orgId: string;
  seasonYear: number;
  name: string;
  subsystem: string;
  stages: Stage[];
  motorFreeRpm: number | null;
  notes: string;
  createdBy: string;
  id?: string | null;
};

export type GearboxUpsertResult = { id: string; wrote: "insert" | "update" };

type GearboxLookupRow = ExistingGearboxRef;

async function loadWriteCandidates(client: PoolClient, input: GearboxSaveInput): Promise<GearboxLookupRow[]> {
  const found: GearboxLookupRow[] = [];

  if (input.id?.trim()) {
    const byId = await client.query<GearboxLookupRow>(
      `SELECT id, org_id::text AS "orgId", season_year AS "seasonYear", name, subsystem
       FROM gearboxes
       WHERE id = $1::uuid AND org_id = $2::uuid`,
      [input.id.trim(), input.orgId],
    );
    found.push(...byId.rows);
  }

  const byIdentity = await client.query<GearboxLookupRow>(
    `SELECT id, org_id::text AS "orgId", season_year AS "seasonYear", name, subsystem
     FROM gearboxes
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

  return found;
}

async function updateGearbox(
  client: PoolClient,
  input: GearboxSaveInput,
  id: string,
): Promise<GearboxUpsertResult> {
  const updated = await client.query<{ id: string }>(
    `UPDATE gearboxes
     SET name = $1, subsystem = $2, stages = $3::jsonb, motor_free_rpm = $4, notes = $5, updated_at = now()
     WHERE id = $6::uuid AND org_id = $7::uuid
     RETURNING id`,
    [input.name, input.subsystem, JSON.stringify(input.stages), input.motorFreeRpm, input.notes, id, input.orgId],
  );
  const wroteId = updated.rows[0]?.id;
  if (!wroteId) throw new Error("You cannot update this gearbox");
  return { id: wroteId, wrote: "update" };
}

/**
 * Persist a gearbox. Same org + season + name + subsystem updates the existing
 * row; a new identity inserts. Migration 0503 unique-indexes that identity, so
 * a concurrent first-save that loses the INSERT race is treated as an update.
 */
export async function upsertGearbox(client: PoolClient, input: GearboxSaveInput): Promise<GearboxUpsertResult> {
  const write = resolveGearboxWrite(input, await loadWriteCandidates(client, input));

  if (write.kind === "update") {
    return updateGearbox(client, input, write.id);
  }

  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO gearboxes (org_id, season_year, name, subsystem, stages, motor_free_rpm, notes, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id`,
      [input.orgId, input.seasonYear, input.name, input.subsystem, JSON.stringify(input.stages), input.motorFreeRpm, input.notes, input.createdBy],
    );
    return { id: inserted.rows[0]!.id, wrote: "insert" };
  } catch (error) {
    const raced = gearboxWriteFromUniqueViolation(error, input, await loadWriteCandidates(client, input));
    if (!raced || raced.kind !== "update") throw error;
    return updateGearbox(client, input, raced.id);
  }
}
