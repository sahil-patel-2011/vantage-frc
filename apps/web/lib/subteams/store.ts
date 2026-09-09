/**
 * Subteam progress — the view a mentor or coach actually needs.
 *
 * Onboarding has always asked which subteam someone is on, and nothing could
 * read it back: `profiles_self` (0001) limits the table to your own row. This
 * reads through `get_subteam_progress` (0611), a SECURITY DEFINER projection
 * that returns name, role, subteam and progress counts and nothing else —
 * profiles also holds date of birth, gender and phone, and none of that belongs
 * in a roster view.
 *
 * The function itself checks that the caller is an owner or admin of the org,
 * so a student cannot pull who owes a form about anyone else.
 */

import type { PoolClient } from "@neondatabase/serverless";

/** Crew values onboarding offers, in the order a team tends to think of them. */
export const SUBTEAM_ORDER = [
  "mechanical",
  "electrical",
  "programming",
  "cad",
  "pit",
  "driver",
  "operator",
  "scout",
  "business",
  "other",
] as const;

export const SUBTEAM_LABELS: Record<string, string> = {
  mechanical: "Mechanical",
  electrical: "Electrical",
  programming: "Programming",
  cad: "CAD & design",
  pit: "Pit crew",
  driver: "Drive team",
  operator: "Drive team — operator",
  scout: "Scouting",
  business: "Business & outreach",
  other: "Not sure yet",
};

export const TEAM_ROLE_LABELS: Record<string, string> = {
  student: "Student",
  mentor: "Mentor",
  coach: "Coach",
  parent: "Parent",
  other: "Other",
};

export type SubteamMember = {
  userId: string;
  displayName: string;
  teamRole: string | null;
  crewRole: string | null;
  onboarded: boolean;
  outstandingForms: number;
  unacknowledgedNotices: number;
};

export type Subteam = {
  id: string;
  label: string;
  members: SubteamMember[];
  /** People on this subteam who still owe something. The list a mentor works. */
  needsAttention: SubteamMember[];
};

export type SubteamProgress = {
  subteams: Subteam[];
  unassigned: SubteamMember[];
  mentorCount: number;
  studentCount: number;
  totalMembers: number;
};

type Row = {
  userId: string;
  displayName: string;
  teamRole: string | null;
  crewRole: string | null;
  onboarded: boolean;
  outstandingForms: number;
  unacknowledgedNotices: number;
};

function needsAttention(member: SubteamMember): boolean {
  return !member.onboarded || member.outstandingForms > 0 || member.unacknowledgedNotices > 0;
}

export async function getSubteamProgress(
  client: PoolClient,
  orgId: string,
): Promise<SubteamProgress> {
  const result = await client.query<Row>(
    `SELECT user_id AS "userId",
            display_name AS "displayName",
            team_role AS "teamRole",
            crew_role AS "crewRole",
            onboarded,
            outstanding_forms AS "outstandingForms",
            unacknowledged_notices AS "unacknowledgedNotices"
       FROM get_subteam_progress($1::uuid)`,
    [orgId],
  );

  const byCrew = new Map<string, SubteamMember[]>();
  const unassigned: SubteamMember[] = [];
  for (const row of result.rows) {
    if (!row.crewRole) {
      unassigned.push(row);
      continue;
    }
    const bucket = byCrew.get(row.crewRole) ?? [];
    bucket.push(row);
    byCrew.set(row.crewRole, bucket);
  }

  // Only subteams that actually have people. An empty column for every possible
  // crew value would be nine bits of chrome saying nothing — and a subteam with
  // nobody on it is better surfaced by the recruiting gap in a Forms intake
  // result than by a blank card here.
  const subteams: Subteam[] = SUBTEAM_ORDER.filter((id) => (byCrew.get(id) ?? []).length > 0).map((id) => {
    const members = byCrew.get(id) ?? [];
    return {
      id,
      label: SUBTEAM_LABELS[id] ?? id,
      members,
      needsAttention: members.filter(needsAttention),
    };
  });

  return {
    subteams,
    unassigned,
    mentorCount: result.rows.filter((row) => row.teamRole === "mentor" || row.teamRole === "coach").length,
    studentCount: result.rows.filter((row) => row.teamRole === "student").length,
    totalMembers: result.rowCount ?? 0,
  };
}
