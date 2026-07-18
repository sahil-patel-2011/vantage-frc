import type { PoolClient } from "@neondatabase/serverless";
import { compareCandidates, computeCandidateStats, rankCandidates } from ".";
import type { SchemaAbCandidate, SchemaAbComparison, SchemaAbSample, SchemaAbStats } from "./types";

export type SchemaAbSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SchemaAbView =
  | {
      status: "setup_required";
      message: string;
      steps: SchemaAbSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      candidates: SchemaAbCandidate[];
      samples: SchemaAbSample[];
      stats: SchemaAbStats[];
      comparison: SchemaAbComparison | null;
      computedAt: string;
    };

type CandidateRow = {
  id: string;
  label: string;
  fieldCount: number;
  notes: string | null;
  createdAt: string;
};

type SampleRow = {
  id: string;
  candidateId: string;
  matchNumber: number | null;
  fieldsTotal: number;
  fieldsCompleted: number;
  fillSeconds: number | null;
  hadError: boolean;
  notes: string | null;
  createdAt: string;
};

function mapCandidate(row: CandidateRow): SchemaAbCandidate {
  return {
    id: row.id,
    label: row.label,
    fieldCount: Number(row.fieldCount) || 0,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

function mapSample(row: SampleRow): SchemaAbSample {
  return {
    id: row.id,
    candidateId: row.candidateId,
    matchNumber: row.matchNumber,
    fieldsTotal: Number(row.fieldsTotal) || 0,
    fieldsCompleted: Number(row.fieldsCompleted) || 0,
    fillSeconds: row.fillSeconds != null ? Number(row.fillSeconds) : null,
    hadError: row.hadError,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string } | null> {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

function setupRequired(orgId: string | null): SchemaAbView {
  return {
    status: "setup_required",
    message: "Select a team workspace to compare scouting schema versions.",
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
    ],
    orgId,
  };
}

export async function computeSchemaAbView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; compareA?: string | null; compareB?: string | null },
): Promise<SchemaAbView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequired(null);

  const [candidateResult, sampleResult] = await Promise.all([
    client.query<CandidateRow>(
      `SELECT id, label, field_count AS "fieldCount", notes, created_at::text AS "createdAt"
       FROM scouting_schema_ab_candidates
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
    client.query<SampleRow>(
      `SELECT id, candidate_id AS "candidateId", match_number AS "matchNumber",
              fields_total AS "fieldsTotal", fields_completed AS "fieldsCompleted",
              fill_seconds AS "fillSeconds", had_error AS "hadError", notes,
              created_at::text AS "createdAt"
       FROM scouting_schema_ab_samples
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
  ]);

  const candidates = candidateResult.rows.map(mapCandidate);
  const samples = sampleResult.rows.map(mapSample);
  const stats = rankCandidates(candidates.map((candidate) => computeCandidateStats(candidate, samples)));

  let comparison: SchemaAbComparison | null = null;
  const aId = input.compareA ?? stats[0]?.candidateId ?? null;
  const bId = input.compareB ?? stats[1]?.candidateId ?? null;
  if (aId && bId && aId !== bId) {
    const aStats = stats.find((s) => s.candidateId === aId);
    const bStats = stats.find((s) => s.candidateId === bId);
    if (aStats && bStats) comparison = compareCandidates(aStats, bStats);
  }

  return {
    status: "live",
    orgId: org.orgId,
    candidates,
    samples,
    stats,
    comparison,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createCandidate(
  client: PoolClient,
  input: { orgId: string; userId: string; label: string; fieldCount: number; notes: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO scouting_schema_ab_candidates (org_id, label, field_count, notes, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.label, Math.max(0, Math.round(input.fieldCount)), input.notes, input.userId],
  );
}

export async function deleteCandidate(
  client: PoolClient,
  input: { orgId: string; candidateId: string },
): Promise<void> {
  await client.query(`DELETE FROM scouting_schema_ab_candidates WHERE id = $1 AND org_id = $2`, [
    input.candidateId,
    input.orgId,
  ]);
}

export async function logSample(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    candidateId: string;
    matchNumber: number | null;
    fieldsTotal: number;
    fieldsCompleted: number;
    fillSeconds: number | null;
    hadError: boolean;
    notes: string | null;
  },
): Promise<void> {
  const fieldsTotal = Math.max(1, Math.round(input.fieldsTotal));
  const fieldsCompleted = Math.min(fieldsTotal, Math.max(0, Math.round(input.fieldsCompleted)));
  await client.query(
    `INSERT INTO scouting_schema_ab_samples (
       org_id, candidate_id, match_number, fields_total, fields_completed,
       fill_seconds, had_error, notes, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.candidateId,
      input.matchNumber,
      fieldsTotal,
      fieldsCompleted,
      input.fillSeconds,
      input.hadError,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteSample(
  client: PoolClient,
  input: { orgId: string; sampleId: string },
): Promise<void> {
  await client.query(`DELETE FROM scouting_schema_ab_samples WHERE id = $1 AND org_id = $2`, [
    input.sampleId,
    input.orgId,
  ]);
}
