import type { PoolClient } from "@neondatabase/serverless";
import { pairwiseNextActions, type PairwiseNextAction } from "./pairwise-next-actions";
import { parseTeamNumber, rankPairwise, type PairwiseRank } from "./rank";

export const DEFAULT_CRITERIA = [
  { slug: "driver_skill", name: "Driver skill", sortOrder: 0 },
  { slug: "defense", name: "Defense", sortOrder: 1 },
  { slug: "field_awareness", name: "Field awareness", sortOrder: 2 },
  { slug: "reliability", name: "Reliability", sortOrder: 3 },
  { slug: "alliance_fit", name: "Alliance fit", sortOrder: 4 },
] as const;

export type PairwiseSetupStep = { id: string; label: string; detail: string; href: string };

export type PairwiseCriterion = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  comparisonCount: number;
};

export type PairwiseComparisonRow = {
  id: string;
  winnerTeamNumber: number;
  loserTeamNumber: number;
  notes: string | null;
  loggedByName: string;
  createdAt: string;
};

export type PairwiseView =
  | {
      status: "setup_required";
      message: string;
      steps: PairwiseSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      eventKey: string | null;
      eventTeams: number[];
      criteria: PairwiseCriterion[];
      criterionId: string | null;
      ranks: PairwiseRank[];
      recent: PairwiseComparisonRow[];
      nextActions: PairwiseNextAction[];
      canManage: boolean;
      computedAt: string;
    };

export function currentPairwiseSeason(now = new Date()): number {
  return now.getUTCFullYear();
}

function setup(message: string, orgId: string | null, seasonYear: number): PairwiseView {
  return {
    status: "setup_required",
    message,
    orgId,
    seasonYear,
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Choose your team.", href: "/workspace" },
      {
        id: "migrate",
        label: "Apply pairwise tables",
        detail: "Owners run npm run db:migrate so qualitative comparisons can persist.",
        href: "/competition",
      },
    ],
  };
}

function isMissingRelation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code: unknown }).code) === "42P01";
}

function teamKeyNumber(teamKey: string): number | null {
  const match = /^frc(\d{1,5})$/i.exec(teamKey.trim());
  return match ? Number(match[1]) : null;
}

export async function computePairwiseView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; criterionId?: string | null },
): Promise<PairwiseView> {
  const seasonYear = currentPairwiseSeason();
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    role: string;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Select a team to rank robots by qualitative taps.", null, seasonYear);

  try {
    for (const criterion of DEFAULT_CRITERIA) {
      await client.query(
        `INSERT INTO qualitative_criteria (org_id, season_year, slug, name, sort_order, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
         ON CONFLICT (org_id, season_year, slug) DO NOTHING`,
        [org.orgId, seasonYear, criterion.slug, criterion.name, criterion.sortOrder, input.userId],
      );
    }

    const criteriaResult = await client.query<{
      id: string;
      slug: string;
      name: string;
      sortOrder: number;
      comparisonCount: string;
    }>(
      `SELECT c.id, c.slug, c.name, c.sort_order AS "sortOrder",
              COUNT(p.id)::text AS "comparisonCount"
       FROM qualitative_criteria c
       LEFT JOIN pairwise_comparisons p ON p.criterion_id = c.id AND p.org_id = c.org_id
       WHERE c.org_id = $1 AND c.season_year = $2
       GROUP BY c.id
       ORDER BY c.sort_order, c.name`,
      [org.orgId, seasonYear],
    );
    const criteria: PairwiseCriterion[] = criteriaResult.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      sortOrder: row.sortOrder,
      comparisonCount: Number(row.comparisonCount) || 0,
    }));
    const criterionId =
      (input.criterionId && criteria.some((row) => row.id === input.criterionId) ? input.criterionId : null) ??
      criteria[0]?.id ??
      null;

    const [comparisons, context, eventTeams] = await Promise.all([
      criterionId
        ? client.query<{
            id: string;
            winnerTeamNumber: number;
            loserTeamNumber: number;
            notes: string | null;
            loggedByName: string;
            createdAt: string;
          }>(
            `SELECT id, winner_team_number AS "winnerTeamNumber", loser_team_number AS "loserTeamNumber",
                    notes,
                    CASE WHEN created_by = current_app_user_id() THEN 'You' ELSE 'Team member' END AS "loggedByName",
                    created_at::text AS "createdAt"
             FROM pairwise_comparisons
             WHERE org_id = $1 AND criterion_id = $2
             ORDER BY created_at DESC
             LIMIT 80`,
            [org.orgId, criterionId],
          )
        : Promise.resolve({ rows: [] as Array<{
            id: string;
            winnerTeamNumber: number;
            loserTeamNumber: number;
            notes: string | null;
            loggedByName: string;
            createdAt: string;
          }> }),
      client.query<{ eventKey: string | null }>(
        `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
        [org.orgId],
      ),
      client.query<{ teamKey: string }>(
        `SELECT DISTINCT team_key AS "teamKey"
         FROM team_event_metrics
         WHERE event_key = (SELECT active_event_key FROM org_active_context WHERE org_id = $1)
         ORDER BY team_key
         LIMIT 80`,
        [org.orgId],
      ),
    ]);

    const recent: PairwiseComparisonRow[] = comparisons.rows;
    const allForRank = criterionId
      ? await client.query<{ winnerTeamNumber: number; loserTeamNumber: number }>(
          `SELECT winner_team_number AS "winnerTeamNumber", loser_team_number AS "loserTeamNumber"
           FROM pairwise_comparisons WHERE org_id = $1 AND criterion_id = $2`,
          [org.orgId, criterionId],
        )
      : { rows: [] as Array<{ winnerTeamNumber: number; loserTeamNumber: number }> };
    const ranks = rankPairwise(allForRank.rows);

    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      eventKey: context.rows[0]?.eventKey ?? null,
      eventTeams: eventTeams.rows
        .map((row) => teamKeyNumber(row.teamKey))
        .filter((value): value is number => value != null),
      criteria,
      criterionId,
      ranks,
      recent,
      nextActions: pairwiseNextActions({
        orgId: org.orgId,
        comparisonCount: allForRank.rows.length,
        rankCount: ranks.length,
        eventKey: context.rows[0]?.eventKey ?? null,
      }),
      canManage: org.role === "owner" || org.role === "admin",
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return setup("Pairwise tables are not installed yet. Run database migrations, then reload.", org.orgId, seasonYear);
    }
    throw error;
  }
}

export async function addPairwiseComparison(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    criterionId: string;
    winnerTeamNumber: unknown;
    loserTeamNumber: unknown;
    notes?: unknown;
  },
): Promise<void> {
  const winner = parseTeamNumber(input.winnerTeamNumber);
  const loser = parseTeamNumber(input.loserTeamNumber);
  if (!winner || !loser) throw new Error("Enter two different FRC team numbers.");
  if (winner === loser) throw new Error("A team cannot outrank itself.");
  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;
  const seasonYear = currentPairwiseSeason();
  const criterion = await client.query(
    `SELECT 1 FROM qualitative_criteria WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.criterionId, input.orgId],
  );
  if (!criterion.rowCount) throw new Error("Choose a qualitative criterion first.");
  const event = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
    [input.orgId],
  );
  await client.query(
    `INSERT INTO pairwise_comparisons
       (org_id, season_year, criterion_id, winner_team_number, loser_team_number, event_key, notes, created_by)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::uuid)`,
    [input.orgId, seasonYear, input.criterionId, winner, loser, event.rows[0]?.eventKey ?? null, notes, input.userId],
  );
}

export async function deletePairwiseComparison(
  client: PoolClient,
  input: { orgId: string; comparisonId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM pairwise_comparisons WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.comparisonId, input.orgId],
  );
}
