import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { evaluateReview, ITEM_VERDICTS, REVIEW_STAGES, REVIEW_STATUSES, stageBlueprint, summarizeReviews } from ".";
import type {
  DesignReview,
  ItemVerdict,
  ReviewEvaluation,
  ReviewItem,
  ReviewStage,
  ReviewStatus,
  ReviewsSummary,
} from "./types";

export { ITEM_VERDICTS, REVIEW_STAGES, REVIEW_STATUSES };

export type ReviewsSetupStep = { id: string; label: string; detail: string; href: string };

export type ReviewsView =
  | {
      status: "setup_required";
      message: string;
      steps: ReviewsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evaluations: ReviewEvaluation[];
      summary: ReviewsSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ReviewRow = {
  id: string;
  title: string;
  subsystem: string;
  stage: ReviewStage;
  status: ReviewStatus;
  scheduledOn: string | null;
  reviewers: string | null;
  items: unknown;
  notes: string | null;
  seasonYear: number;
  createdAt: string;
};

const VALID_VERDICTS = new Set<ItemVerdict>(["pending", "pass", "fail", "na"]);

function coerceItems(value: unknown): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : randomUUID(),
      criterion: typeof item.criterion === "string" ? item.criterion : "",
      verdict: VALID_VERDICTS.has(item.verdict as ItemVerdict) ? (item.verdict as ItemVerdict) : "pending",
      blocking: item.blocking === true,
      notes: typeof item.notes === "string" ? item.notes : null,
    }))
    .filter((item) => item.criterion.length > 0);
}

function mapReview(row: ReviewRow): DesignReview {
  return {
    id: row.id,
    title: row.title,
    subsystem: row.subsystem,
    stage: row.stage,
    status: row.status,
    scheduledOn: row.scheduledOn,
    reviewers: row.reviewers,
    items: coerceItems(row.items),
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

export async function computeReviewsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ReviewsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run design reviews.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [reviewResult, seasonResult] = await Promise.all([
    client.query<ReviewRow>(
      `SELECT id, title, subsystem, stage, status, scheduled_on::text AS "scheduledOn",
              reviewers, items, notes, season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM design_reviews
       WHERE org_id = $1 AND season_year = $2
       ORDER BY COALESCE(scheduled_on, created_at::date) DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM design_reviews WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const reviews = reviewResult.rows.map(mapReview);
  const evaluations = reviews.map(evaluateReview);
  const summary = summarizeReviews(reviews);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evaluations,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

function newItem(criterion: string, blocking: boolean): ReviewItem {
  return { id: randomUUID(), criterion, verdict: "pending", blocking, notes: null };
}

async function readItems(client: PoolClient, orgId: string, reviewId: string): Promise<ReviewItem[] | null> {
  const result = await client.query<{ items: unknown }>(
    `SELECT items FROM design_reviews WHERE id = $1 AND org_id = $2 FOR UPDATE`,
    [reviewId, orgId],
  );
  if (!result.rowCount) return null;
  return coerceItems(result.rows[0]?.items);
}

async function writeItems(client: PoolClient, orgId: string, reviewId: string, items: ReviewItem[]): Promise<void> {
  await client.query(
    `UPDATE design_reviews SET items = $3::jsonb, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [reviewId, orgId, JSON.stringify(items)],
  );
}

export async function createReview(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    subsystem: string;
    stage: ReviewStage;
    scheduledOn: string | null;
    reviewers: string | null;
    seedChecklist: boolean;
  },
): Promise<void> {
  const items = input.seedChecklist
    ? stageBlueprint(input.stage).map((entry) => newItem(entry.criterion, entry.blocking))
    : [];
  await client.query(
    `INSERT INTO design_reviews (org_id, season_year, title, subsystem, stage, status, scheduled_on, reviewers, items, created_by)
     VALUES ($1,$2,$3,$4,$5,'scheduled',$6::date,$7,$8::jsonb,$9)`,
    [
      input.orgId,
      input.seasonYear,
      input.title,
      input.subsystem || "general",
      input.stage,
      input.scheduledOn,
      input.reviewers,
      JSON.stringify(items),
      input.userId,
    ],
  );
}

export async function updateReview(
  client: PoolClient,
  input: {
    orgId: string;
    reviewId: string;
    title?: string;
    subsystem?: string;
    stage?: ReviewStage;
    status?: ReviewStatus;
    scheduledOn?: string | null;
    reviewers?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await client.query(
    `UPDATE design_reviews SET
       title = COALESCE($3, title),
       subsystem = COALESCE($4, subsystem),
       stage = COALESCE($5, stage),
       status = COALESCE($6, status),
       scheduled_on = CASE WHEN $7::boolean THEN $8::date ELSE scheduled_on END,
       reviewers = CASE WHEN $9::boolean THEN $10 ELSE reviewers END,
       notes = CASE WHEN $11::boolean THEN $12 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.reviewId,
      input.orgId,
      input.title ?? null,
      input.subsystem ?? null,
      input.stage ?? null,
      input.status ?? null,
      input.scheduledOn !== undefined,
      input.scheduledOn ?? null,
      input.reviewers !== undefined,
      input.reviewers ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
}

export async function deleteReview(client: PoolClient, input: { orgId: string; reviewId: string }): Promise<void> {
  await client.query(`DELETE FROM design_reviews WHERE id = $1 AND org_id = $2`, [input.reviewId, input.orgId]);
}

export async function addItem(
  client: PoolClient,
  input: { orgId: string; reviewId: string; criterion: string; blocking: boolean },
): Promise<void> {
  const items = await readItems(client, input.orgId, input.reviewId);
  if (items == null) return;
  items.push(newItem(input.criterion, input.blocking));
  await writeItems(client, input.orgId, input.reviewId, items);
}

export async function updateItem(
  client: PoolClient,
  input: { orgId: string; reviewId: string; itemId: string; verdict?: ItemVerdict; blocking?: boolean },
): Promise<void> {
  const items = await readItems(client, input.orgId, input.reviewId);
  if (items == null) return;
  const next = items.map((item) =>
    item.id === input.itemId
      ? {
          ...item,
          verdict: input.verdict ?? item.verdict,
          blocking: input.blocking ?? item.blocking,
        }
      : item,
  );
  await writeItems(client, input.orgId, input.reviewId, next);
}

export async function removeItem(
  client: PoolClient,
  input: { orgId: string; reviewId: string; itemId: string },
): Promise<void> {
  const items = await readItems(client, input.orgId, input.reviewId);
  if (items == null) return;
  await writeItems(client, input.orgId, input.reviewId, items.filter((item) => item.id !== input.itemId));
}
