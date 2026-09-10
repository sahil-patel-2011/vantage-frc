import type { PoolClient } from "@neondatabase/serverless";
import { withOrgHref } from "../nav/product-nav";
import { assignOnboardingTracks } from "./assign";
import { TRACK_BY_KEY } from "./tracks";
import type { RoleOnboardingView, StartTrackView, TrackSource } from "./types";

type ProfileRow = {
  teamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
  primaryFocus: string | null;
};

type OrgRow = {
  name: string;
};

type TrackRow = {
  trackKey: string;
  source: TrackSource;
  dismissedAt: Date | string | null;
};

type CheckRow = {
  trackKey: string;
  checkKey: string;
  completedAt: Date | string;
};

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function loadContext(client: PoolClient, userId: string, orgId: string) {
  const org = await client.query<OrgRow>(
    `SELECT name FROM organizations WHERE id = $1::uuid LIMIT 1`,
    [orgId],
  );
  if (!org.rows[0]) return null;

  const member = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  if (!member.rows[0]) return null;

  const profile = await client.query<ProfileRow>(
    `SELECT team_role AS "teamRole", crew_role AS "crewRole",
            role_description AS "roleDescription", primary_focus AS "primaryFocus"
     FROM profiles WHERE user_id = $1::uuid LIMIT 1`,
    [userId],
  );

  const subteams = await client.query<{ name: string }>(
    `SELECT s.name
     FROM team_subteam_members m
     JOIN team_subteams s ON s.id = m.subteam_id
     WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid
     ORDER BY s.sort_order ASC, lower(s.name) ASC`,
    [orgId, userId],
  );

  return {
    orgName: org.rows[0].name,
    teamRole: profile.rows[0]?.teamRole ?? null,
    crewRole: profile.rows[0]?.crewRole ?? null,
    roleDescription: profile.rows[0]?.roleDescription ?? null,
    primaryFocus: profile.rows[0]?.primaryFocus ?? null,
    subteamNames: subteams.rows.map((row) => row.name),
  };
}

async function ensureTracks(
  client: PoolClient,
  orgId: string,
  userId: string,
  assigned: ReturnType<typeof assignOnboardingTracks>,
) {
  for (const track of assigned) {
    await client.query(
      `INSERT INTO member_onboarding_tracks (org_id, user_id, track_key, source)
       VALUES ($1::uuid, $2::uuid, $3::text, $4::text)
       ON CONFLICT (org_id, user_id, track_key) DO NOTHING`,
      [orgId, userId, track.trackKey, track.source],
    );
  }
}

function buildTracksView(
  orgId: string,
  assigned: ReturnType<typeof assignOnboardingTracks>,
  trackRows: TrackRow[],
  checkRows: CheckRow[],
): StartTrackView[] {
  const dismissed = new Map(
    trackRows.map((row) => [row.trackKey, row.dismissedAt != null] as const),
  );
  const completed = new Map<string, string>();
  for (const row of checkRows) {
    completed.set(`${row.trackKey}::${row.checkKey}`, iso(row.completedAt) ?? "");
  }
  const reasonByKey = new Map(assigned.map((a) => [a.trackKey, a.reason] as const));

  const views: StartTrackView[] = [];
  for (const assignment of assigned) {
    const template = TRACK_BY_KEY[assignment.trackKey];
    if (!template) continue;
    const checks = template.checks.map((check) => {
      const doneAt = completed.get(`${template.key}::${check.key}`) ?? null;
      return {
        key: check.key,
        label: check.label,
        detail: check.detail,
        href: check.href ? withOrgHref(check.href, orgId) : null,
        done: doneAt != null,
        completedAt: doneAt,
      };
    });
    const doneCount = checks.filter((c) => c.done).length;
    views.push({
      key: template.key,
      title: template.title,
      summary: template.summary,
      source: assignment.source,
      reason: reasonByKey.get(template.key) ?? assignment.reason,
      dismissed: dismissed.get(template.key) === true,
      doneCount,
      totalCount: checks.length,
      checks,
    });
  }
  return views;
}

export async function loadRoleOnboarding(
  client: PoolClient,
  input: { userId: string; orgId: string | null | undefined },
): Promise<RoleOnboardingView> {
  const orgId = input.orgId?.trim() || null;
  if (!orgId) {
    return {
      status: "setup_required",
      message: "Choose your team to open your onboarding path.",
    };
  }

  const ctx = await loadContext(client, input.userId, orgId);
  if (!ctx) {
    return {
      status: "setup_required",
      message: "Join a team to see role-based onboarding checklists.",
    };
  }

  const assigned = assignOnboardingTracks({
    teamRole: ctx.teamRole,
    crewRole: ctx.crewRole,
    roleDescription: ctx.roleDescription,
    primaryFocus: ctx.primaryFocus,
    subteamNames: ctx.subteamNames,
  });

  await ensureTracks(client, orgId, input.userId, assigned);

  const tracksResult = await client.query<TrackRow>(
    `SELECT track_key AS "trackKey", source, dismissed_at AS "dismissedAt"
     FROM member_onboarding_tracks
     WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, input.userId],
  );
  const checksResult = await client.query<CheckRow>(
    `SELECT track_key AS "trackKey", check_key AS "checkKey", completed_at AS "completedAt"
     FROM member_onboarding_checks
     WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, input.userId],
  );

  const tracks = buildTracksView(orgId, assigned, tracksResult.rows, checksResult.rows);
  const active = tracks.filter((t) => !t.dismissed);
  const doneCount = active.reduce((sum, t) => sum + t.doneCount, 0);
  const totalCount = active.reduce((sum, t) => sum + t.totalCount, 0);

  return {
    status: "live",
    orgId,
    orgName: ctx.orgName,
    teamRole: ctx.teamRole,
    crewRole: ctx.crewRole,
    roleDescription: ctx.roleDescription,
    primaryFocus: ctx.primaryFocus,
    subteamNames: ctx.subteamNames,
    doneCount,
    totalCount,
    tracks,
  };
}

export async function setCheckCompleted(
  client: PoolClient,
  input: {
    userId: string;
    orgId: string;
    trackKey: string;
    checkKey: string;
    done: boolean;
  },
): Promise<RoleOnboardingView> {
  const template = TRACK_BY_KEY[input.trackKey];
  if (!template || !template.checks.some((c) => c.key === input.checkKey)) {
    throw new Error("Unknown checklist item.");
  }
  const context = await loadContext(client, input.userId, input.orgId);
  const assigned = context ? assignOnboardingTracks({
    teamRole: context.teamRole,
    crewRole: context.crewRole,
    roleDescription: context.roleDescription,
    primaryFocus: context.primaryFocus,
    subteamNames: context.subteamNames,
  }) : [];
  if (!assigned.some((item) => item.trackKey === input.trackKey)) {
    throw new Error("That checklist is not assigned to your role or subteam.");
  }

  if (input.done) {
    await client.query(
      `INSERT INTO member_onboarding_checks (org_id, user_id, track_key, check_key)
       VALUES ($1::uuid, $2::uuid, $3::text, $4::text)
       ON CONFLICT (org_id, user_id, track_key, check_key) DO NOTHING`,
      [input.orgId, input.userId, input.trackKey, input.checkKey],
    );
  } else {
    await client.query(
      `DELETE FROM member_onboarding_checks
       WHERE org_id = $1::uuid AND user_id = $2::uuid
         AND track_key = $3::text AND check_key = $4::text`,
      [input.orgId, input.userId, input.trackKey, input.checkKey],
    );
  }

  return loadRoleOnboarding(client, { userId: input.userId, orgId: input.orgId });
}

export async function setTrackDismissed(
  client: PoolClient,
  input: {
    userId: string;
    orgId: string;
    trackKey: string;
    dismissed: boolean;
  },
): Promise<RoleOnboardingView> {
  if (!TRACK_BY_KEY[input.trackKey]) throw new Error("Unknown track.");
  const context = await loadContext(client, input.userId, input.orgId);
  const assigned = context ? assignOnboardingTracks({
    teamRole: context.teamRole,
    crewRole: context.crewRole,
    roleDescription: context.roleDescription,
    primaryFocus: context.primaryFocus,
    subteamNames: context.subteamNames,
  }) : [];
  if (!assigned.some((item) => item.trackKey === input.trackKey)) {
    throw new Error("That path is not assigned to your role or subteam.");
  }

  await client.query(
    `INSERT INTO member_onboarding_tracks (org_id, user_id, track_key, source, dismissed_at)
     VALUES ($1::uuid, $2::uuid, $3::text, 'manual', CASE WHEN $4::boolean THEN now() ELSE NULL END)
     ON CONFLICT (org_id, user_id, track_key) DO UPDATE
       SET dismissed_at = CASE WHEN $4::boolean THEN now() ELSE NULL END`,
    [input.orgId, input.userId, input.trackKey, input.dismissed],
  );

  return loadRoleOnboarding(client, { userId: input.userId, orgId: input.orgId });
}

export async function refreshRoleOnboarding(
  client: PoolClient,
  input: { userId: string; orgId: string },
): Promise<RoleOnboardingView> {
  return loadRoleOnboarding(client, input);
}
