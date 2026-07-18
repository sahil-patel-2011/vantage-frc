import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildWhoWeAreSeed,
  coerceAchievementList,
  emptyBackgroundProfile,
  isAdminRole,
  parseBackgroundSave,
  type TeamBackgroundProfile,
  type TeamBackgroundView,
} from "../../../../lib/team-background";

type MembershipRow = {
  role: string;
  orgName: string | null;
  teamNumber: number | null;
  city: string | null;
  stateProv: string | null;
  description: string | null;
};

type ProfileRow = {
  mission: string | null;
  history: string | null;
  demographics: string | null;
  achievements: unknown;
  studentCount: number | null;
  mentorCount: number | null;
  foundedYear: number | null;
  updatedAt: string | null;
};

function mapProfile(row: ProfileRow | undefined): TeamBackgroundProfile {
  if (!row) return emptyBackgroundProfile();
  return {
    mission: row.mission,
    history: row.history,
    demographics: row.demographics,
    achievements: coerceAchievementList(row.achievements),
    studentCount: row.studentCount,
    mentorCount: row.mentorCount,
    foundedYear: row.foundedYear,
  };
}

async function loadView(
  client: {
    query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
  },
  orgId: string,
  userId: string,
): Promise<TeamBackgroundView> {
  const membership = await client.query<MembershipRow>(
    `SELECT m.role,
            o.name AS "orgName",
            o.team_number AS "teamNumber",
            o.city,
            o.state_prov AS "stateProv",
            o.description
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
    [orgId, userId],
  );
  if (!membership.rowCount) throw new Error("Organization access denied");
  const member = membership.rows[0]!;

  const profileResult = await client.query<ProfileRow>(
    `SELECT mission, history, demographics, achievements,
            student_count AS "studentCount",
            mentor_count AS "mentorCount",
            founded_year AS "foundedYear",
            updated_at::text AS "updatedAt"
     FROM team_background_profile
     WHERE org_id = $1::uuid`,
    [orgId],
  );

  const profile = mapProfile(profileResult.rows[0]);
  return {
    orgId,
    role: member.role,
    canEdit: isAdminRole(member.role),
    org: {
      city: member.city,
      stateProv: member.stateProv,
      description: member.description,
      orgName: member.orgName,
      teamNumber: member.teamNumber,
    },
    profile,
    updatedAt: profileResult.rows[0]?.updatedAt ?? null,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const view = await withRls({ userId: session.user.id, orgId }, (client) =>
      loadView(client, orgId, session.user.id),
    );
    return Response.json(
      { ...view, seedWhoWeAre: buildWhoWeAreSeed(view.org, view.profile) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load team background";
    const status = message === "Organization access denied" ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const input = parseBackgroundSave(body);
  const userId = session.user.id;

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
        [orgId, userId],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");
      if (!isAdminRole(membership.rows[0]!.role)) {
        throw new Error("Only owners and admins can edit the team background profile");
      }

      await client.query(
        `UPDATE organizations
         SET city = $2,
             state_prov = $3,
             description = $4
         WHERE id = $1::uuid`,
        [orgId, input.city, input.stateProv, input.description],
      );

      await client.query(
        `INSERT INTO team_background_profile (
           org_id, mission, history, demographics, achievements,
           student_count, mentor_count, founded_year, updated_by
         ) VALUES (
           $1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::uuid
         )
         ON CONFLICT (org_id) DO UPDATE SET
           mission = EXCLUDED.mission,
           history = EXCLUDED.history,
           demographics = EXCLUDED.demographics,
           achievements = EXCLUDED.achievements,
           student_count = EXCLUDED.student_count,
           mentor_count = EXCLUDED.mentor_count,
           founded_year = EXCLUDED.founded_year,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          orgId,
          input.mission,
          input.history,
          input.demographics,
          JSON.stringify(input.achievements),
          input.studentCount,
          input.mentorCount,
          input.foundedYear,
          userId,
        ],
      );

      return loadView(client, orgId, userId);
    });

    return Response.json(
      { ok: true, ...view, seedWhoWeAre: buildWhoWeAreSeed(view.org, view.profile) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save team background";
    const status =
      message === "Organization access denied"
        ? 403
        : message.startsWith("Only owners")
          ? 403
          : 400;
    return Response.json({ error: message }, { status });
  }
}
