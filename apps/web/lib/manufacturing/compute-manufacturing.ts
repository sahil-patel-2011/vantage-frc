import type { PoolClient } from "@neondatabase/serverless";
import {
  atRiskParts,
  cycleTimeByState,
  isAllowedTransition,
  partsMissingDueDate,
  subsystemCoverage,
} from ".";
import type {
  BomSeedOption,
  CycleTimeSummary,
  ManufacturingMethod,
  ManufacturingPart,
  ManufacturingPriority,
  ManufacturingState,
  ManufacturingStateEvent,
  MemberOption,
  SubsystemCoverageRow,
  SubsystemOption,
} from "./types";

export type ManufacturingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ManufacturingView =
  | {
      status: "setup_required";
      message: string;
      steps: ManufacturingSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      today: string;
      parts: ManufacturingPart[];
      events: ManufacturingStateEvent[];
      atRisk: ManufacturingPart[];
      noDueDate: ManufacturingPart[];
      cycleTime: CycleTimeSummary;
      coverage: SubsystemCoverageRow[];
      subsystems: SubsystemOption[];
      bomOptions: BomSeedOption[];
      members: MemberOption[];
      computedAt: string;
    };

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** FRC season year: September onward belongs to the next January's game. */
export function defaultSeasonYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

type PartRow = {
  id: string;
  seasonYear: number;
  partName: string;
  quantity: number;
  method: ManufacturingMethod;
  state: ManufacturingState;
  priority: ManufacturingPriority;
  subsystemId: string | null;
  subsystemName: string | null;
  bomEntryId: string | null;
  inventoryItemId: string | null;
  buildTaskId: string | null;
  material: string | null;
  stockNote: string | null;
  neededBy: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  requestedBy: string;
  scrapReason: string | null;
  reprintOfId: string | null;
  createdAt: string;
  updatedAt: string;
};

type EventRow = {
  id: string;
  partId: string;
  fromState: ManufacturingState | null;
  toState: ManufacturingState;
  note: string | null;
  createdAt: string;
};

export async function computeManufacturingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ManufacturingView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to track parts through manufacturing.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [partResult, eventResult, subsystemResult, bomResult, memberResult] = await Promise.all([
    client.query<PartRow>(
      `SELECT p.id, p.season_year AS "seasonYear", p.part_name AS "partName", p.quantity,
              p.method, p.state, p.priority,
              p.subsystem_id AS "subsystemId", rs.name AS "subsystemName",
              p.bom_entry_id AS "bomEntryId", p.inventory_item_id AS "inventoryItemId",
              p.build_task_id AS "buildTaskId", p.material, p.stock_note AS "stockNote",
              p.needed_by::text AS "neededBy", p.assigned_to AS "assignedTo",
              au.name AS "assignedName", p.requested_by AS "requestedBy",
              p.scrap_reason AS "scrapReason", p.reprint_of_id AS "reprintOfId",
              p.created_at::text AS "createdAt", p.updated_at::text AS "updatedAt"
       FROM manufacturing_parts p
       LEFT JOIN robot_subsystems rs ON rs.id = p.subsystem_id
       LEFT JOIN users au ON au.id = p.assigned_to
       WHERE p.org_id = $1::uuid
       ORDER BY p.created_at DESC`,
      [org.orgId],
    ),
    client.query<EventRow>(
      `SELECT id, part_id AS "partId", from_state AS "fromState", to_state AS "toState",
              note, created_at::text AS "createdAt"
       FROM manufacturing_state_events
       WHERE org_id = $1::uuid
       ORDER BY created_at ASC`,
      [org.orgId],
    ),
    client.query<SubsystemOption>(
      `SELECT id, name, season_year AS "seasonYear"
       FROM robot_subsystems
       WHERE org_id = $1::uuid
       ORDER BY season_year DESC, name ASC`,
      [org.orgId],
    ),
    client.query<BomSeedOption>(
      `SELECT b.id, b.subsystem, i.name AS "itemName", i.part_number AS "partNumber",
              b.quantity_needed AS "quantityNeeded",
              EXISTS (
                SELECT 1 FROM manufacturing_parts mp WHERE mp.bom_entry_id = b.id
              ) AS "alreadySeeded"
       FROM bom_entries b
       JOIN inventory_items i ON i.id = b.item_id
       WHERE b.org_id = $1::uuid
       ORDER BY b.subsystem ASC, i.name ASC`,
      [org.orgId],
    ),
    client.query<MemberOption>(
      `SELECT m.user_id AS "userId", u.name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1::uuid
       ORDER BY u.name ASC`,
      [org.orgId],
    ),
  ]);

  const parts = partResult.rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
  const events = eventResult.rows;
  const bomOptions = bomResult.rows.map((row) => ({ ...row, quantityNeeded: Number(row.quantityNeeded) }));
  const today = todayIso();

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    today,
    parts,
    events,
    atRisk: atRiskParts({ parts, today }),
    noDueDate: partsMissingDueDate(parts),
    cycleTime: cycleTimeByState(events),
    coverage: subsystemCoverage(parts, subsystemResult.rows),
    subsystems: subsystemResult.rows,
    bomOptions,
    members: memberResult.rows,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction, which is atomic) ----

export type AddPartInput = {
  orgId: string;
  userId: string;
  partName: string;
  quantity: number;
  method: ManufacturingMethod;
  priority: ManufacturingPriority;
  seasonYear: number;
  subsystemId: string | null;
  bomEntryId: string | null;
  inventoryItemId: string | null;
  buildTaskId: string | null;
  material: string | null;
  stockNote: string | null;
  neededBy: string | null;
  reprintOfId: string | null;
};

export async function addPart(client: PoolClient, input: AddPartInput): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO manufacturing_parts (
       org_id, season_year, part_name, quantity, method, priority,
       subsystem_id, bom_entry_id, inventory_item_id, build_task_id,
       material, stock_note, needed_by, requested_by, reprint_of_id
     ) VALUES (
       $1::uuid, $2::int, $3, $4::int, $5, $6,
       $7::uuid, $8::uuid, $9::uuid, $10::uuid,
       $11, $12, $13::date, $14::uuid, $15::uuid
     )
     RETURNING id`,
    [
      input.orgId,
      input.seasonYear,
      input.partName,
      input.quantity,
      input.method,
      input.priority,
      input.subsystemId,
      input.bomEntryId,
      input.inventoryItemId,
      input.buildTaskId,
      input.material,
      input.stockNote,
      input.neededBy,
      input.userId,
      input.reprintOfId,
    ],
  );
  const partId = inserted.rows[0]?.id;
  if (!partId) throw new Error("Could not create the part");
  await client.query(
    `INSERT INTO manufacturing_state_events (org_id, part_id, from_state, to_state, note, actor_user_id)
     VALUES ($1::uuid, $2::uuid, NULL, 'needs_design', $3, $4::uuid)`,
    [input.orgId, partId, "Part created", input.userId],
  );
  return partId;
}

export async function updatePart(
  client: PoolClient,
  input: {
    orgId: string;
    partId: string;
    partName: string;
    quantity: number;
    method: ManufacturingMethod;
    priority: ManufacturingPriority;
    subsystemId: string | null;
    material: string | null;
    stockNote: string | null;
    neededBy: string | null;
  },
): Promise<void> {
  const result = await client.query(
    `UPDATE manufacturing_parts
     SET part_name = $3, quantity = $4::int, method = $5, priority = $6,
         subsystem_id = $7::uuid, material = $8, stock_note = $9, needed_by = $10::date,
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [
      input.partId,
      input.orgId,
      input.partName,
      input.quantity,
      input.method,
      input.priority,
      input.subsystemId,
      input.material,
      input.stockNote,
      input.neededBy,
    ],
  );
  if (!result.rowCount) throw new Error("Part not found");
}

/**
 * Moves a part along the state machine and appends the history event in the SAME
 * transaction (withRls wraps the caller in BEGIN/COMMIT). Illegal moves are refused.
 */
export async function moveState(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    partId: string;
    toState: ManufacturingState;
    note: string | null;
    scrapReason?: string | null;
  },
): Promise<void> {
  const current = await client.query<{ state: ManufacturingState }>(
    `SELECT state FROM manufacturing_parts WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [input.partId, input.orgId],
  );
  const fromState = current.rows[0]?.state;
  if (!fromState) throw new Error("Part not found");
  if (!isAllowedTransition(fromState, input.toState)) {
    throw new Error(`Cannot move a part from ${fromState} to ${input.toState}`);
  }

  await client.query(
    `UPDATE manufacturing_parts
     SET state = $3,
         scrap_reason = CASE WHEN $3 = 'scrapped' THEN $4 ELSE scrap_reason END,
         updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.partId, input.orgId, input.toState, input.scrapReason ?? null],
  );
  await client.query(
    `INSERT INTO manufacturing_state_events (org_id, part_id, from_state, to_state, note, actor_user_id)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)`,
    [input.orgId, input.partId, fromState, input.toState, input.note, input.userId],
  );
}

export async function assignPart(
  client: PoolClient,
  input: { orgId: string; partId: string; assignedTo: string | null },
): Promise<void> {
  const result = await client.query(
    `UPDATE manufacturing_parts SET assigned_to = $3::uuid, updated_at = now()
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.partId, input.orgId, input.assignedTo],
  );
  if (!result.rowCount) throw new Error("Part not found");
}

/**
 * One-tap seed: each selected bom_entries row becomes ONE manufacturing card in
 * needs_design. Deliberately manual — never triggered automatically from the BOM.
 */
export async function bulkAddFromBom(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    bomEntryIds: string[];
    subsystemId: string | null;
    seasonYear: number;
  },
): Promise<number> {
  let created = 0;
  for (const bomEntryId of input.bomEntryIds) {
    const entry = await client.query<{ itemId: string; itemName: string; quantityNeeded: string }>(
      `SELECT b.item_id AS "itemId", i.name AS "itemName", b.quantity_needed AS "quantityNeeded"
       FROM bom_entries b
       JOIN inventory_items i ON i.id = b.item_id
       WHERE b.id = $1::uuid AND b.org_id = $2::uuid`,
      [bomEntryId, input.orgId],
    );
    const row = entry.rows[0];
    if (!row) continue;
    const quantity = Math.max(1, Math.ceil(Number(row.quantityNeeded) || 1));
    await addPart(client, {
      orgId: input.orgId,
      userId: input.userId,
      partName: row.itemName.slice(0, 160),
      quantity,
      method: "other",
      priority: "normal",
      seasonYear: input.seasonYear,
      subsystemId: input.subsystemId,
      bomEntryId,
      inventoryItemId: row.itemId,
      buildTaskId: null,
      material: null,
      stockNote: null,
      neededBy: null,
      reprintOfId: null,
    });
    created += 1;
  }
  return created;
}
