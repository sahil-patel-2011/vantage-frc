import type { PoolClient } from "@neondatabase/serverless";
import {
  CAD_REVIEW_CHECKPOINTS,
  CAD_REVIEW_DECISIONS,
  CAD_REVIEW_PRIORITIES,
  CAD_REVIEW_STATUSES,
  summarizeCadReviewQueue,
} from ".";
import type {
  CadReviewCheckpoint,
  CadReviewDecision,
  CadReviewItem,
  CadReviewPriority,
  CadReviewSignoff,
  CadReviewStatus,
  CadReviewSummary,
} from "./types";

export type CadReviewQueueSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CadReviewQueueView =
  | {
      status: "setup_required";
      message: string;
      steps: CadReviewQueueSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      items: CadReviewItem[];
      summary: CadReviewSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ItemRow = {
  id: string;
  partName: string;
  description: string | null;
  checkpoint: CadReviewCheckpoint;
  status: CadReviewStatus;
  cadLink: string | null;
  priority: CadReviewPriority;
  submittedBy: string;
  requiredSignoffs: number;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type SignoffRow = {
  id: string;
  itemId: string;
  reviewerId: string;
  decision: CadReviewDecision;
  comment: string | null;
  createdAt: string;
};

function mapSignoff(row: SignoffRow): CadReviewSignoff {
  return {
    id: row.id,
    reviewerId: row.reviewerId,
    decision: row.decision,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

function mapItem(row: ItemRow, signoffs: CadReviewSignoff[]): CadReviewItem {
  return {
    id: row.id,
    partName: row.partName,
    description: row.description,
    checkpoint: row.checkpoint,
    status: row.status,
    cadLink: row.cadLink,
    priority: row.priority,
    submittedBy: row.submittedBy,
    requiredSignoffs: Number(row.requiredSignoffs) || 1,
    seasonYear: row.seasonYear,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    signoffs,
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

export async function computeCadReviewQueueView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CadReviewQueueView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to open the CAD review queue.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [itemResult, seasonResult] = await Promise.all([
    client.query<ItemRow>(
      `SELECT id, part_name AS "partName", description, checkpoint, status, cad_link AS "cadLink",
              priority, submitted_by AS "submittedBy", required_signoffs AS "requiredSignoffs",
              season_year AS "seasonYear", notes,
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
       FROM cad_review_queue_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM cad_review_queue_items WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const itemIds = itemResult.rows.map((row) => row.id);
  const signoffsByItem = new Map<string, CadReviewSignoff[]>();
  if (itemIds.length > 0) {
    const signoffResult = await client.query<SignoffRow>(
      `SELECT id, item_id AS "itemId", reviewer_id AS "reviewerId", decision, comment,
              created_at::text AS "createdAt"
       FROM cad_review_queue_signoffs
       WHERE org_id = $1 AND item_id = ANY($2::uuid[])
       ORDER BY created_at DESC`,
      [org.orgId, itemIds],
    );
    for (const row of signoffResult.rows) {
      const mapped = mapSignoff(row);
      const existing = signoffsByItem.get(row.itemId);
      if (existing) existing.push(mapped);
      else signoffsByItem.set(row.itemId, [mapped]);
    }
  }

  const items = itemResult.rows.map((row) => mapItem(row, signoffsByItem.get(row.id) ?? []));
  const summary = summarizeCadReviewQueue(items);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    items,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function submitItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    partName: string;
    description: string | null;
    checkpoint: CadReviewCheckpoint;
    cadLink: string | null;
    priority: CadReviewPriority;
    requiredSignoffs: number;
    seasonYear: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cad_review_queue_items (
       org_id, part_name, description, checkpoint, cad_link, priority,
       submitted_by, required_signoffs, season_year, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.partName,
      input.description,
      input.checkpoint,
      input.cadLink,
      input.priority,
      input.userId,
      Math.max(1, Math.round(input.requiredSignoffs)),
      input.seasonYear,
      input.notes,
    ],
  );
}

export async function addSignoff(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    itemId: string;
    decision: CadReviewDecision;
    comment: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO cad_review_queue_signoffs (org_id, item_id, reviewer_id, decision, comment)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.itemId, input.userId, input.decision, input.comment],
  );

  const nextStatus: CadReviewStatus = input.decision === "changes_requested" ? "changes_requested" : "approved";
  await client.query(
    `UPDATE cad_review_queue_items
     SET status = CASE
           WHEN $3 = 'changes_requested' THEN 'changes_requested'
           WHEN (SELECT COUNT(*) FROM cad_review_queue_signoffs
                 WHERE item_id = $1 AND org_id = $2 AND decision = 'approved') >= required_signoffs
             THEN 'approved'
           ELSE status
         END,
         updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId, nextStatus],
  );
}

export async function updateItemStatus(
  client: PoolClient,
  input: { orgId: string; itemId: string; status: CadReviewStatus },
): Promise<void> {
  await client.query(
    `UPDATE cad_review_queue_items SET status = $3, updated_at = now() WHERE id = $1 AND org_id = $2`,
    [input.itemId, input.orgId, input.status],
  );
}

export async function deleteItem(client: PoolClient, input: { orgId: string; itemId: string }): Promise<void> {
  await client.query(`DELETE FROM cad_review_queue_items WHERE id = $1 AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
}

export { CAD_REVIEW_CHECKPOINTS, CAD_REVIEW_DECISIONS, CAD_REVIEW_PRIORITIES, CAD_REVIEW_STATUSES };
