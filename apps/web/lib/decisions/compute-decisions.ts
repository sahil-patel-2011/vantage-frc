import type { PoolClient } from "@neondatabase/serverless";
import { resolveSupersession, summarizeDecisions } from ".";
import type { DecisionCategory, DecisionRecord, DecisionStatus, DecisionsSummary, ResolvedDecision } from "./types";

export const DECISION_CATEGORIES: DecisionCategory[] = ["design", "strategy", "build", "business", "process", "other"];
export const DECISION_STATUSES: DecisionStatus[] = ["proposed", "accepted", "rejected", "superseded"];

export type DecisionsSetupStep = { id: string; label: string; detail: string; href: string };

export type DecisionsView =
  | {
      status: "setup_required";
      message: string;
      steps: DecisionsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      decisions: ResolvedDecision[];
      summary: DecisionsSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type DecisionRow = {
  id: string;
  title: string;
  category: DecisionCategory;
  status: DecisionStatus;
  context: string | null;
  decision: string | null;
  rationale: string | null;
  options: unknown;
  decidedOn: string | null;
  deciders: string | null;
  supersedesId: string | null;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
};

function coerceOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mapDecision(row: DecisionRow): DecisionRecord {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    context: row.context,
    decision: row.decision,
    rationale: row.rationale,
    options: coerceOptions(row.options),
    decidedOn: row.decidedOn,
    deciders: row.deciders,
    supersedesId: row.supersedesId,
    notes: row.notes,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
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

export async function computeDecisionsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DecisionsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to record engineering and strategy decisions.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [decisionResult, seasonResult] = await Promise.all([
    client.query<DecisionRow>(
      `SELECT id, title, category, status, context, decision, rationale, options,
              decided_on::text AS "decidedOn", deciders, supersedes_id AS "supersedesId",
              notes, season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM decision_records
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM decision_records WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const records = decisionResult.rows.map(mapDecision);
  const decisions = resolveSupersession(records);
  const summary = summarizeDecisions(records);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    decisions,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/** Only allow supersedes references to decisions inside the same org. */
async function validSupersedesId(
  client: PoolClient,
  orgId: string,
  supersedesId: string | null,
  selfId?: string,
): Promise<string | null> {
  if (!supersedesId || supersedesId === selfId) return null;
  const found = await client.query(`SELECT 1 FROM decision_records WHERE id = $1 AND org_id = $2`, [
    supersedesId,
    orgId,
  ]);
  return found.rowCount ? supersedesId : null;
}

export async function createDecision(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    category: DecisionCategory;
    status: DecisionStatus;
    context: string | null;
    decision: string | null;
    rationale: string | null;
    options: string[];
    decidedOn: string | null;
    deciders: string | null;
    supersedesId: string | null;
    notes: string | null;
  },
): Promise<void> {
  const supersedesId = await validSupersedesId(client, input.orgId, input.supersedesId);
  await client.query(
    `INSERT INTO decision_records
       (org_id, season_year, title, category, status, context, decision, rationale, options,
        decided_on, deciders, supersedes_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::date,$11,$12,$13,$14)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.category,
      input.status,
      input.context,
      input.decision,
      input.rationale,
      JSON.stringify(input.options ?? []),
      input.decidedOn,
      input.deciders,
      supersedesId,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateDecision(
  client: PoolClient,
  input: {
    orgId: string;
    decisionId: string;
    title?: string;
    category?: DecisionCategory;
    status?: DecisionStatus;
    context?: string | null;
    decision?: string | null;
    rationale?: string | null;
    options?: string[];
    decidedOn?: string | null;
    deciders?: string | null;
    supersedesId?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const supersedesId =
    input.supersedesId === undefined
      ? undefined
      : await validSupersedesId(client, input.orgId, input.supersedesId, input.decisionId);
  await client.query(
    `UPDATE decision_records SET
       title = COALESCE($3, title),
       category = COALESCE($4, category),
       status = COALESCE($5, status),
       context = CASE WHEN $6::boolean THEN $7 ELSE context END,
       decision = CASE WHEN $8::boolean THEN $9 ELSE decision END,
       rationale = CASE WHEN $10::boolean THEN $11 ELSE rationale END,
       options = CASE WHEN $12::boolean THEN $13::jsonb ELSE options END,
       decided_on = CASE WHEN $14::boolean THEN $15::date ELSE decided_on END,
       deciders = CASE WHEN $16::boolean THEN $17 ELSE deciders END,
       supersedes_id = CASE WHEN $18::boolean THEN $19 ELSE supersedes_id END,
       notes = CASE WHEN $20::boolean THEN $21 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.decisionId,
      input.orgId,
      input.title ?? null,
      input.category ?? null,
      input.status ?? null,
      input.context !== undefined,
      input.context ?? null,
      input.decision !== undefined,
      input.decision ?? null,
      input.rationale !== undefined,
      input.rationale ?? null,
      input.options !== undefined,
      JSON.stringify(input.options ?? []),
      input.decidedOn !== undefined,
      input.decidedOn ?? null,
      input.deciders !== undefined,
      input.deciders ?? null,
      supersedesId !== undefined,
      supersedesId ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteDecision(
  client: PoolClient,
  input: { orgId: string; decisionId: string },
): Promise<void> {
  await client.query(`DELETE FROM decision_records WHERE id = $1 AND org_id = $2`, [input.decisionId, input.orgId]);
}
