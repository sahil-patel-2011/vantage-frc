import type { PoolClient } from "@neondatabase/serverless";
import { computeSubsystemSignoffReadiness, summarizeSubsystemSignoff } from ".";
import type {
  SignoffDecision,
  SignoffGate,
  SignoffRecord,
  Subsystem,
  SubsystemCategory,
  SubsystemSignoffReadiness,
  SubsystemSignoffSummary,
  SubsystemStatus,
} from "./types";

export type SubsystemSignoffSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SubsystemSignoffView =
  | {
      status: "setup_required";
      message: string;
      steps: SubsystemSignoffSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      subsystems: Subsystem[];
      records: SignoffRecord[];
      summary: SubsystemSignoffSummary;
      readiness: SubsystemSignoffReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type SubsystemRow = {
  id: string;
  name: string;
  category: SubsystemCategory;
  status: SubsystemStatus;
  notes: string | null;
  seasonYear: number;
};

type RecordRow = {
  id: string;
  subsystemId: string;
  gate: SignoffGate;
  decision: SignoffDecision;
  reviewerId: string;
  signedOn: string;
  notes: string | null;
};

function mapSubsystem(row: SubsystemRow): Subsystem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    status: row.status,
    notes: row.notes,
    seasonYear: row.seasonYear,
  };
}

function mapRecord(row: RecordRow): SignoffRecord {
  return {
    id: row.id,
    subsystemId: row.subsystemId,
    gate: row.gate,
    decision: row.decision,
    reviewerId: row.reviewerId,
    signedOn: row.signedOn,
    notes: row.notes,
  };
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

export async function computeSubsystemSignoffView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SubsystemSignoffView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to track subsystem sign-offs.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [subsystemResult, seasonResult] = await Promise.all([
    client.query<SubsystemRow>(
      `SELECT id, name, category, status, notes, season_year AS "seasonYear"
       FROM subsystem_signoff_subsystems
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM subsystem_signoff_subsystems WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const subsystems = subsystemResult.rows.map(mapSubsystem);
  const subsystemIds = subsystems.map((s) => s.id);

  const recordResult = subsystemIds.length
    ? await client.query<RecordRow>(
        `SELECT id, subsystem_id AS "subsystemId", gate, decision, reviewer_id AS "reviewerId",
                signed_on::text AS "signedOn", notes
         FROM subsystem_signoff_records
         WHERE org_id = $1 AND subsystem_id = ANY($2::uuid[])
         ORDER BY signed_on DESC, created_at DESC`,
        [org.orgId, subsystemIds],
      )
    : { rows: [] as RecordRow[] };

  const records = recordResult.rows.map(mapRecord);
  const summary = summarizeSubsystemSignoff(subsystems, records);
  const readiness = computeSubsystemSignoffReadiness(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    subsystems,
    records,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addSubsystem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    category: SubsystemCategory;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO subsystem_signoff_subsystems (
       org_id, name, category, notes, season_year, added_by
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.name, input.category, input.notes, input.seasonYear, input.userId],
  );
}

export async function updateSubsystemStatus(
  client: PoolClient,
  input: { orgId: string; subsystemId: string; status: SubsystemStatus },
): Promise<void> {
  await client.query(
    `UPDATE subsystem_signoff_subsystems SET status = $1 WHERE id = $2 AND org_id = $3`,
    [input.status, input.subsystemId, input.orgId],
  );
}

export async function deleteSubsystem(
  client: PoolClient,
  input: { orgId: string; subsystemId: string },
): Promise<void> {
  await client.query(`DELETE FROM subsystem_signoff_subsystems WHERE id = $1 AND org_id = $2`, [
    input.subsystemId,
    input.orgId,
  ]);
}

export async function recordSignoff(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    subsystemId: string;
    gate: SignoffGate;
    decision: SignoffDecision;
    signedOn: string;
    notes: string | null;
  },
): Promise<void> {
  // Guard: the subsystem must belong to this org (RLS also enforces, this makes intent explicit).
  const owns = await client.query(
    `SELECT 1 FROM subsystem_signoff_subsystems WHERE id = $1 AND org_id = $2`,
    [input.subsystemId, input.orgId],
  );
  if (!owns.rowCount) throw new Error("Subsystem not found");

  await client.query(
    `INSERT INTO subsystem_signoff_records (
       org_id, subsystem_id, gate, decision, reviewer_id, signed_on, notes
     ) VALUES ($1,$2,$3,$4,$5,$6::date,$7)`,
    [
      input.orgId,
      input.subsystemId,
      input.gate,
      input.decision,
      input.userId,
      input.signedOn,
      input.notes,
    ],
  );
}

export async function deleteSignoff(
  client: PoolClient,
  input: { orgId: string; recordId: string },
): Promise<void> {
  await client.query(`DELETE FROM subsystem_signoff_records WHERE id = $1 AND org_id = $2`, [
    input.recordId,
    input.orgId,
  ]);
}
