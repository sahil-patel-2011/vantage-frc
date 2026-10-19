// Shop steps (0737) — reads and writes under the caller's withRls transaction.
//
// Ships ahead of its migration: until 0737 is applied every entry point answers
// a calm "not set up yet" view instead of failing, and the board keeps working.

import type { PoolClient } from "@neondatabase/serverless";
import { probeSchemaSupport } from "../schema-probe";
import { moveState } from "./compute-manufacturing";
import {
  KIOSK_STATES,
  MAX_STEPS_PER_PART,
  sortForKiosk,
  stateAfterAllStepsDone,
  stateAfterStepReopened,
  stateAfterStepStart,
  stepTemplate,
  type ShopPart,
  type ShopStep,
  type ShopStepsView,
  type StepStatus,
} from "./steps-model";

export type { ShopStepsView };
import type { ManufacturingMethod, ManufacturingState, MemberOption } from "./types";


export const SHOP_STEPS_MIGRATION_MESSAGE =
  "Shop steps aren't switched on for this team yet. An admin applies database update 0737, then this page fills in.";

// Remembered only once it is true: the migration is applied while servers are
// running, and a cached "no" would hide the feature until the next deploy.
let stepsSupported = false;

export async function shopStepsSupported(client: PoolClient): Promise<boolean> {
  if (stepsSupported) return true;
  const supported = await probeSchemaSupport(
    client,
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'manufacturing_steps' AND column_name = 'worked_by')
          OR (table_name = 'manufacturing_parts' AND column_name = 'drawing_url'))
     HAVING count(*) = 2`,
  );
  if (supported) stepsSupported = true;
  return supported === true;
}

async function resolveShopOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; role: string } | null> {
  const result = await client.query<{ orgId: string; role: string }>(
    `SELECT m.org_id AS "orgId", m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

type PartRow = Omit<ShopPart, "steps">;
type StepRow = ShopStep;

async function loadParts(client: PoolClient, orgId: string, filter: { partId?: string; kiosk?: boolean }): Promise<ShopPart[]> {
  const parts = await client.query<PartRow>(
    `SELECT p.id, p.part_name AS "partName", p.quantity, p.method, p.state, p.material,
            p.needed_by::text AS "neededBy", s.name AS "subsystemName", p.drawing_url AS "drawingUrl"
       FROM manufacturing_parts p
       LEFT JOIN robot_subsystems s ON s.id = p.subsystem_id
      WHERE p.org_id = $1::uuid
        AND ($2::uuid IS NULL OR p.id = $2::uuid)
        AND ($3::text[] IS NULL OR p.state = ANY($3::text[]))
      ORDER BY p.needed_by NULLS LAST, p.created_at
      LIMIT 200`,
    [orgId, filter.partId ?? null, filter.kiosk ? [...KIOSK_STATES] : null],
  );
  if (!parts.rows.length) return [];
  const steps = await client.query<StepRow>(
    `SELECT st.id, st.part_id AS "partId", st.position, st.title, st.machine, st.notes, st.status,
            st.worked_by AS "workedBy", COALESCE(u.name, u.email) AS "workedByName",
            st.started_at::text AS "startedAt", st.done_at::text AS "doneAt"
       FROM manufacturing_steps st
       LEFT JOIN users u ON u.id = st.worked_by
      WHERE st.org_id = $1::uuid AND st.part_id = ANY($2::uuid[])
      ORDER BY st.position, st.created_at`,
    [orgId, parts.rows.map((part) => part.id)],
  );
  const byPart = new Map<string, ShopStep[]>();
  for (const step of steps.rows) {
    const list = byPart.get(step.partId) ?? [];
    list.push(step);
    byPart.set(step.partId, list);
  }
  const shaped = parts.rows.map((part) => ({ ...part, steps: byPart.get(part.id) ?? [] }));
  // The kiosk shows parts that have a step list; a part with none has nothing to work through yet.
  return filter.kiosk ? sortForKiosk(shaped.filter((part) => part.steps.length > 0)) : shaped;
}

async function loadMembers(client: PoolClient, orgId: string): Promise<MemberOption[]> {
  const result = await client.query<MemberOption>(
    `SELECT m.user_id AS "userId", COALESCE(NULLIF(u.name, ''), u.email) AS name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid AND m.role::text <> 'viewer'
      ORDER BY 2`,
    [orgId],
  );
  return result.rows;
}

/** One part's steps (the drawing QR page), or the whole shop queue (the kiosk). */
export async function computeShopStepsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; partId?: string | null; kiosk?: boolean },
): Promise<ShopStepsView> {
  const org = await resolveShopOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return { status: "setup_required", reason: "no_team", message: "Choose your team to see the shop.", orgId: null };
  }
  if (!(await shopStepsSupported(client))) {
    return { status: "setup_required", reason: "migration", message: SHOP_STEPS_MIGRATION_MESSAGE, orgId: org.orgId };
  }
  const parts = await loadParts(client, org.orgId, { partId: input.partId ?? undefined, kiosk: input.kiosk });
  const members = await loadMembers(client, org.orgId);
  return {
    status: "live",
    orgId: org.orgId,
    canEdit: org.role !== "viewer",
    parts,
    members,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- writes

export type ShopStepAction =
  | { action: "add-step"; partId: string; title: string; machine: string | null; notes: string | null }
  | { action: "use-template"; partId: string }
  | { action: "edit-step"; stepId: string; title: string; machine: string | null; notes: string | null }
  | { action: "move-step"; stepId: string; direction: "up" | "down" }
  | { action: "delete-step"; stepId: string }
  | { action: "start-step"; stepId: string; workedBy: string | null }
  | { action: "finish-step"; stepId: string; workedBy: string | null }
  | { action: "reopen-step"; stepId: string }
  | { action: "set-drawing"; partId: string; drawingUrl: string | null };

/** Validates a drawing link: http(s) only, so a QR never opens a javascript: or file: address. */
export function cleanDrawingUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("Drawing link must be a web address.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Drawing link must be a web address, like an Onshape drawing or a PDF in your team drive.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Drawing link must start with https://.");
  if (parsed.toString().length > 2000) throw new Error("That drawing link is too long.");
  return parsed.toString();
}

async function lockPart(client: PoolClient, orgId: string, partId: string): Promise<{ state: ManufacturingState; method: ManufacturingMethod }> {
  const result = await client.query<{ state: ManufacturingState; method: ManufacturingMethod }>(
    `SELECT state, method FROM manufacturing_parts WHERE id = $1::uuid AND org_id = $2::uuid FOR UPDATE`,
    [partId, orgId],
  );
  const part = result.rows[0];
  if (!part) throw new Error("Part not found.");
  return part;
}

async function stepRow(client: PoolClient, orgId: string, stepId: string): Promise<{ partId: string; position: number; status: StepStatus; title: string }> {
  const result = await client.query<{ partId: string; position: number; status: StepStatus; title: string }>(
    `SELECT part_id AS "partId", position, status, title FROM manufacturing_steps WHERE id = $1::uuid AND org_id = $2::uuid`,
    [stepId, orgId],
  );
  const step = result.rows[0];
  if (!step) throw new Error("Step not found.");
  return step;
}

async function assertWorker(client: PoolClient, orgId: string, workedBy: string): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid AND role::text <> 'viewer'`,
    [orgId, workedBy],
  );
  if (!result.rowCount) throw new Error("Pick someone on the team.");
}

async function insertSteps(
  client: PoolClient,
  input: { orgId: string; userId: string; partId: string; steps: Array<{ title: string; machine: string | null; notes?: string | null }> },
): Promise<void> {
  const count = await client.query<{ count: number; next: number }>(
    `SELECT count(*)::int AS count, COALESCE(max(position) + 1, 0)::int AS next
       FROM manufacturing_steps WHERE org_id = $1::uuid AND part_id = $2::uuid`,
    [input.orgId, input.partId],
  );
  const existing = count.rows[0] ?? { count: 0, next: 0 };
  if (existing.count + input.steps.length > MAX_STEPS_PER_PART) {
    throw new Error(`A part can have up to ${MAX_STEPS_PER_PART} steps.`);
  }
  let position = existing.next;
  for (const step of input.steps) {
    await client.query(
      `INSERT INTO manufacturing_steps (org_id, part_id, position, title, machine, notes, created_by, updated_by)
       VALUES ($1::uuid, $2::uuid, $3::int, $4, $5, $6, $7::uuid, $7::uuid)`,
      [input.orgId, input.partId, position, step.title, step.machine, step.notes ?? null, input.userId],
    );
    position += 1;
  }
}

/** Moves the part along the board when a step change calls for it (same history as the board). */
async function followWithPart(
  client: PoolClient,
  input: { orgId: string; userId: string; partId: string; from: ManufacturingState; to: ManufacturingState | null; note: string },
): Promise<void> {
  if (!input.to || input.to === input.from) return;
  await moveState(client, { orgId: input.orgId, userId: input.userId, partId: input.partId, toState: input.to, note: input.note });
}

export async function applyShopStepAction(
  client: PoolClient,
  input: { orgId: string; userId: string; change: ShopStepAction },
): Promise<void> {
  if (!(await shopStepsSupported(client))) throw new Error(SHOP_STEPS_MIGRATION_MESSAGE);
  const { orgId, userId, change } = input;
  switch (change.action) {
    case "add-step": {
      await lockPart(client, orgId, change.partId);
      await insertSteps(client, { orgId, userId, partId: change.partId, steps: [change] });
      return;
    }
    case "use-template": {
      const part = await lockPart(client, orgId, change.partId);
      const template = stepTemplate(part.method);
      if (!template.length) throw new Error("There's no starter list for this kind of part. Add the steps one by one.");
      const existing = await client.query(`SELECT 1 FROM manufacturing_steps WHERE org_id = $1::uuid AND part_id = $2::uuid LIMIT 1`, [orgId, change.partId]);
      if (existing.rowCount) throw new Error("This part already has steps.");
      await insertSteps(client, { orgId, userId, partId: change.partId, steps: template });
      return;
    }
    case "edit-step": {
      await stepRow(client, orgId, change.stepId);
      await client.query(
        `UPDATE manufacturing_steps SET title = $3, machine = $4, notes = $5, updated_by = $6::uuid, updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [change.stepId, orgId, change.title, change.machine, change.notes, userId],
      );
      return;
    }
    case "move-step": {
      const step = await stepRow(client, orgId, change.stepId);
      await lockPart(client, orgId, step.partId);
      const neighbor = await client.query<{ id: string; position: number }>(
        change.direction === "up"
          ? `SELECT id, position FROM manufacturing_steps WHERE org_id = $1::uuid AND part_id = $2::uuid AND position < $3::int ORDER BY position DESC LIMIT 1`
          : `SELECT id, position FROM manufacturing_steps WHERE org_id = $1::uuid AND part_id = $2::uuid AND position > $3::int ORDER BY position ASC LIMIT 1`,
        [orgId, step.partId, step.position],
      );
      const other = neighbor.rows[0];
      if (!other) return;
      await client.query(`UPDATE manufacturing_steps SET position = $3::int, updated_by = $4::uuid, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`, [change.stepId, orgId, other.position, userId]);
      await client.query(`UPDATE manufacturing_steps SET position = $3::int, updated_by = $4::uuid, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`, [other.id, orgId, step.position, userId]);
      return;
    }
    case "delete-step": {
      await stepRow(client, orgId, change.stepId);
      await client.query(`DELETE FROM manufacturing_steps WHERE id = $1::uuid AND org_id = $2::uuid`, [change.stepId, orgId]);
      return;
    }
    case "start-step": {
      const step = await stepRow(client, orgId, change.stepId);
      const part = await lockPart(client, orgId, step.partId);
      if (step.status !== "todo") return;
      const workedBy = change.workedBy ?? userId;
      if (change.workedBy) await assertWorker(client, orgId, change.workedBy);
      await client.query(
        `UPDATE manufacturing_steps SET status = 'doing', started_at = now(), worked_by = $3::uuid, updated_by = $4::uuid, updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid AND status = 'todo'`,
        [change.stepId, orgId, workedBy, userId],
      );
      await followWithPart(client, { orgId, userId, partId: step.partId, from: part.state, to: stateAfterStepStart(part.state), note: `Started: ${step.title}` });
      return;
    }
    case "finish-step": {
      const step = await stepRow(client, orgId, change.stepId);
      const part = await lockPart(client, orgId, step.partId);
      if (step.status === "done") return;
      if (change.workedBy) await assertWorker(client, orgId, change.workedBy);
      await client.query(
        `UPDATE manufacturing_steps
            SET status = 'done', done_at = now(), started_at = COALESCE(started_at, now()),
                worked_by = COALESCE($3::uuid, worked_by, $4::uuid), updated_by = $4::uuid, updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [change.stepId, orgId, change.workedBy, userId],
      );
      // Done without pressing Start first still means the part went on the machine.
      let state = part.state;
      const started = step.status === "todo" ? stateAfterStepStart(state) : null;
      if (started) {
        await followWithPart(client, { orgId, userId, partId: step.partId, from: state, to: started, note: `Started: ${step.title}` });
        state = started;
      }
      const left = await client.query(
        `SELECT 1 FROM manufacturing_steps WHERE org_id = $1::uuid AND part_id = $2::uuid AND status <> 'done' LIMIT 1`,
        [orgId, step.partId],
      );
      if (!left.rowCount) {
        await followWithPart(client, { orgId, userId, partId: step.partId, from: state, to: stateAfterAllStepsDone(state), note: "All shop steps done" });
      }
      return;
    }
    case "reopen-step": {
      const step = await stepRow(client, orgId, change.stepId);
      const part = await lockPart(client, orgId, step.partId);
      if (step.status === "todo") return;
      await client.query(
        `UPDATE manufacturing_steps SET status = 'todo', started_at = NULL, done_at = NULL, worked_by = NULL, updated_by = $3::uuid, updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid`,
        [change.stepId, orgId, userId],
      );
      await followWithPart(client, { orgId, userId, partId: step.partId, from: part.state, to: stateAfterStepReopened(part.state), note: `Reopened: ${step.title}` });
      return;
    }
    case "set-drawing": {
      await lockPart(client, orgId, change.partId);
      await client.query(
        `UPDATE manufacturing_parts SET drawing_url = $3, updated_at = now() WHERE id = $1::uuid AND org_id = $2::uuid`,
        [change.partId, orgId, change.drawingUrl],
      );
      return;
    }
  }
}
