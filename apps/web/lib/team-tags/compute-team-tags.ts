import type { PoolClient } from "@neondatabase/serverless";
import { groupTeamTags, type TagBoardColumn, type TeamTagAssignment } from "./group";
import { parseTeamNumber } from "../pairwise/rank";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export const DEFAULT_TEAM_TAGS = [
  { slug: "defense", name: "Defense", sortOrder: 0 },
  { slug: "no_climb", name: "No climb", sortOrder: 1 },
  { slug: "slow_cycles", name: "Slow cycles", sortOrder: 2 },
  { slug: "strong_auto", name: "Strong auto", sortOrder: 3 },
  { slug: "good_partner", name: "Good partner", sortOrder: 4 },
  { slug: "unreliable", name: "Unreliable", sortOrder: 5 },
] as const;

export type TeamTagsSetupStep = { id: string; label: string; detail: string; href: string };
export type TeamTagsNextAction = { id: string; label: string; detail: string; href: string; primary?: boolean };

export type TeamTagDef = { id: string; slug: string; name: string; sortOrder: number };

export type TeamTagsView =
  | {
      status: "setup_required";
      message: string;
      steps: TeamTagsSetupStep[];
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
      defs: TeamTagDef[];
      assignments: TeamTagAssignment[];
      board: TagBoardColumn[];
      nextActions: TeamTagsNextAction[];
      computedAt: string;
    };

export function currentTeamTagsSeason(now = new Date()): number {
  return now.getUTCFullYear();
}

function setup(message: string, orgId: string | null, seasonYear: number): TeamTagsView {
  return {
    status: "setup_required",
    message,
    orgId,
    seasonYear,
    steps: [
      { id: "workspace", label: "Select workspace", detail: "Choose your team organization.", href: "/workspace" },
      {
        id: "migrate",
        label: "Apply tag tables",
        detail: "Owners run npm run db:migrate so qualitative tags persist.",
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

export function teamTagsNextActions(ctx: {
  orgId?: string | null;
  assignmentCount?: number;
  eventKey?: string | null;
}): TeamTagsNextAction[] {
  const orgId = ctx.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before tagging robots.",
        href: "/workspace",
        primary: true,
      },
    ];
  }
  const actions: TeamTagsNextAction[] = [];
  if ((ctx.assignmentCount ?? 0) === 0) {
    actions.push({
      id: "first-tag",
      label: "Tag a robot you just watched",
      detail: "The board stays empty until a scout applies a real qualitative tag.",
      href: withOrgHref("/team-tags", orgId),
      primary: true,
    });
  }
  actions.push({
    id: "pairwise",
    label: "Open pairwise ranking",
    detail: "Tags are labels. Pairwise ranks who looked better from A-beats-B taps.",
    href: withOrgHref("/pairwise", orgId),
  });
  actions.push({
    id: "scouting",
    label: "Open match scouting",
    detail: "Cycle counts still live on Scouting forms — tags do not replace numbers.",
    href: hubHref("/competition", "scouting", orgId),
  });
  return actions.slice(0, 5);
}

export async function computeTeamTagsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<TeamTagsView> {
  const seasonYear = currentTeamTagsSeason();
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) return setup("Select a team workspace to tag robots for the drive team.", null, seasonYear);

  try {
    for (const tag of DEFAULT_TEAM_TAGS) {
      await client.query(
        `INSERT INTO qualitative_tag_defs (org_id, season_year, slug, name, sort_order, created_by)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid)
         ON CONFLICT (org_id, season_year, slug) DO NOTHING`,
        [org.orgId, seasonYear, tag.slug, tag.name, tag.sortOrder, input.userId],
      );
    }

    const [defs, assignments, context, eventTeams] = await Promise.all([
      client.query<TeamTagDef>(
        `SELECT id, slug, name, sort_order AS "sortOrder"
         FROM qualitative_tag_defs WHERE org_id = $1 AND season_year = $2
         ORDER BY sort_order, name`,
        [org.orgId, seasonYear],
      ),
      client.query<TeamTagAssignment>(
        `SELECT t.id, t.tag_id AS "tagId", d.slug AS "tagSlug", d.name AS "tagName",
                t.team_number AS "teamNumber", t.event_key AS "eventKey", t.match_key AS "matchKey", t.notes
         FROM qualitative_team_tags t
         JOIN qualitative_tag_defs d ON d.id = t.tag_id AND d.org_id = t.org_id
         WHERE t.org_id = $1 AND t.season_year = $2
         ORDER BY d.sort_order, t.team_number
         LIMIT 500`,
        [org.orgId, seasonYear],
      ),
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

    const eventKey = context.rows[0]?.eventKey ?? null;
    return {
      status: "live",
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      eventKey,
      eventTeams: eventTeams.rows
        .map((row) => teamKeyNumber(row.teamKey))
        .filter((value): value is number => value != null),
      defs: defs.rows,
      assignments: assignments.rows,
      board: groupTeamTags(assignments.rows),
      nextActions: teamTagsNextActions({
        orgId: org.orgId,
        assignmentCount: assignments.rows.length,
        eventKey,
      }),
      computedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return setup("Team tag tables are not installed yet. Run database migrations, then reload.", org.orgId, seasonYear);
    }
    throw error;
  }
}

export async function addTeamTag(
  client: PoolClient,
  input: { orgId: string; userId: string; tagId: string; teamNumber: unknown; notes?: unknown },
): Promise<void> {
  const teamNumber = parseTeamNumber(input.teamNumber);
  if (!teamNumber) throw new Error("Enter a valid FRC team number.");
  const notes =
    typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 400) : null;
  const def = await client.query(`SELECT 1 FROM qualitative_tag_defs WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.tagId,
    input.orgId,
  ]);
  if (!def.rowCount) throw new Error("Choose a tag from the vocabulary.");
  const event = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
    [input.orgId],
  );
  await client.query(
    `INSERT INTO qualitative_team_tags
       (org_id, season_year, tag_id, team_number, event_key, notes, created_by)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::uuid)
     ON CONFLICT ON CONSTRAINT qualitative_team_tags_once_uq
     DO NOTHING`,
    [
      input.orgId,
      currentTeamTagsSeason(),
      input.tagId,
      teamNumber,
      event.rows[0]?.eventKey ?? null,
      notes,
      input.userId,
    ],
  );
}

export async function deleteTeamTag(
  client: PoolClient,
  input: { orgId: string; assignmentId: string },
): Promise<void> {
  await client.query(`DELETE FROM qualitative_team_tags WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.assignmentId,
    input.orgId,
  ]);
}
