import type { PoolClient } from "@neondatabase/serverless";
import { DEFAULT_PHASE_BUDGETS, lintSnapshot, summarizeSnapshots } from ".";
import type { FieldBudgetLintResult, FieldBudgetSnapshot, FieldBudgetSummary } from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export type ScoutFieldBudgetSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutFieldBudgetView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutFieldBudgetSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      snapshots: FieldBudgetSnapshot[];
      lints: FieldBudgetLintResult[];
      summary: FieldBudgetSummary;
      budgets: Record<string, number>;
      computedAt: string;
    };

type SnapshotRow = {
  id: string;
  schemaName: string;
  autoFields: number;
  teleopFields: number;
  endgameFields: number;
  pitFields: number;
  postMatchFields: number;
  notes: string | null;
  createdAt: string;
};

function mapSnapshot(row: SnapshotRow): FieldBudgetSnapshot {
  const autoFields = Number(row.autoFields) || 0;
  const teleopFields = Number(row.teleopFields) || 0;
  const endgameFields = Number(row.endgameFields) || 0;
  const pitFields = Number(row.pitFields) || 0;
  const postMatchFields = Number(row.postMatchFields) || 0;
  return {
    id: row.id,
    schemaName: row.schemaName,
    autoFields,
    teleopFields,
    endgameFields,
    pitFields,
    postMatchFields,
    liveFields: autoFields + teleopFields + endgameFields,
    totalFields: autoFields + teleopFields + endgameFields + pitFields + postMatchFields,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

export async function computeScoutFieldBudgetView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ScoutFieldBudgetView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to lint scouting schemas against a field-count budget.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const result = await client.query<SnapshotRow>(
    `SELECT id, schema_name AS "schemaName", auto_fields AS "autoFields",
            teleop_fields AS "teleopFields", endgame_fields AS "endgameFields",
            pit_fields AS "pitFields", post_match_fields AS "postMatchFields",
            notes, created_at::text AS "createdAt"
     FROM scout_field_budget_snapshots
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [org.orgId],
  );

  const snapshots = result.rows.map(mapSnapshot);
  const lints = snapshots.map((snapshot) => lintSnapshot(snapshot));
  const summary = summarizeSnapshots(snapshots);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    snapshots,
    lints,
    summary,
    budgets: DEFAULT_PHASE_BUDGETS,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logSnapshot(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    schemaName: string;
    autoFields: number;
    teleopFields: number;
    endgameFields: number;
    pitFields: number;
    postMatchFields: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO scout_field_budget_snapshots (
       org_id, schema_name, auto_fields, teleop_fields, endgame_fields,
       pit_fields, post_match_fields, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.schemaName,
      Math.max(0, Math.round(input.autoFields)),
      Math.max(0, Math.round(input.teleopFields)),
      Math.max(0, Math.round(input.endgameFields)),
      Math.max(0, Math.round(input.pitFields)),
      Math.max(0, Math.round(input.postMatchFields)),
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteSnapshot(
  client: PoolClient,
  input: { orgId: string; snapshotId: string },
): Promise<void> {
  await client.query(`DELETE FROM scout_field_budget_snapshots WHERE id = $1 AND org_id = $2`, [
    input.snapshotId,
    input.orgId,
  ]);
}
