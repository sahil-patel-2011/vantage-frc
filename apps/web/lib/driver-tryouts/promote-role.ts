/**
 * Selected tryout → Season role holder.
 *
 * Marking a candidate `selected` used to stop on the tryouts board. Season roles
 * (`/roles`, `team_roles`) is the roster of who actually holds Driver / Operator /
 * Human player, so a selection that never writes a holder leaves the two boards
 * out of sync.
 *
 * This helper upserts that holder when the roles table exists (`to_regclass`).
 * A database that has not run migration 0130 is a no-op — the status write still
 * succeeds. Holder identity goes through `canonicalHolderName` / `resolveRoleHolder`
 * so we store the roster spelling when we are certain and never invent a member
 * link. Unscored tryouts stay score-less in notes — never a fabricated 0 average.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { RosterMember } from "../presence/match-names";
import { canonicalHolderName, resolveRoleHolder } from "../roles/holders";
import type { DriverTryoutsRole, DriverTryoutsStatus } from "./types";

export const DRIVE_TEAM_SUBTEAM = "drive_team" as const;

export type PromoteRoleSkipReason =
  | "not_selected"
  | "roles_unavailable"
  | "candidate_missing"
  | "empty_name";

export type PromoteRoleResult =
  | { status: "skipped"; reason: PromoteRoleSkipReason }
  | {
      status: "created" | "updated";
      roleId: string;
      title: string;
      holderName: string;
      holderUserId: string | null;
    };

export type SeasonRoleHolderWrite = {
  title: string;
  holderName: string | null;
  holderUserId: string | null;
};

const SEAT_TITLES: Record<Exclude<DriverTryoutsRole, "any">, string> = {
  driver: "Driver",
  operator: "Operator",
  human_player: "Human player",
};

export function shouldPromoteToSeasonRole(status: DriverTryoutsStatus): boolean {
  return status === "selected";
}

/** Season role title for a tryout seat. `any` becomes "Drive team", not "Any seat". */
export function seasonRoleTitleForTryout(role: DriverTryoutsRole): string {
  return role === "any" ? "Drive team" : SEAT_TITLES[role];
}

/**
 * Notes for a newly created seat. A real logged average may be mentioned; null / 0
 * / non-finite values stay off the note — zeros are never invented scores.
 */
export function seasonRoleSelectionNotes(overallAverage?: number | null): string {
  if (
    typeof overallAverage === "number" &&
    Number.isFinite(overallAverage) &&
    overallAverage >= 1
  ) {
    return `Selected from driver tryouts · avg ${overallAverage}/5.`;
  }
  return "Selected from driver tryouts.";
}

/** Pure write payload: roster-canonical name when certain, otherwise the typed name. */
export function seasonRoleHolderFromCandidate(
  candidate: { name: string; roleInterest: DriverTryoutsRole },
  roster: RosterMember[],
): SeasonRoleHolderWrite {
  const holderName = canonicalHolderName(candidate.name, roster);
  const resolved = resolveRoleHolder(candidate.name, roster);
  return {
    title: seasonRoleTitleForTryout(candidate.roleInterest),
    holderName,
    holderUserId: resolved.holderUserId,
  };
}

export async function rolesApiExists(client: PoolClient): Promise<boolean> {
  try {
    const reg = await client.query<{ ok: string | null }>(
      `SELECT to_regclass('public.team_roles')::text AS ok`,
    );
    return Boolean(reg.rows[0]?.ok);
  } catch {
    return false;
  }
}

async function holderUserIdColumnExists(client: PoolClient): Promise<boolean> {
  try {
    const cols = await client.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'team_roles'
         AND column_name = 'holder_user_id'
       LIMIT 1`,
    );
    return Boolean(cols.rowCount);
  } catch {
    return false;
  }
}

async function loadRoster(client: PoolClient, orgId: string): Promise<RosterMember[]> {
  try {
    const rows = await client.query<{ userId: string; name: string | null }>(
      `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
       FROM memberships m
       INNER JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1::uuid
       ORDER BY lower(COALESCE(u.name, u.email))`,
      [orgId],
    );
    return rows.rows;
  } catch {
    return [];
  }
}

type CandidateRow = {
  id: string;
  name: string;
  roleInterest: DriverTryoutsRole;
  seasonYear: number;
};

async function loadCandidate(
  client: PoolClient,
  input: { orgId: string; candidateId: string },
): Promise<CandidateRow | null> {
  const result = await client.query<CandidateRow>(
    `SELECT id, name, role_interest AS "roleInterest", season_year AS "seasonYear"
     FROM driver_tryouts_candidates
     WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.candidateId, input.orgId],
  );
  return result.rows[0] ?? null;
}

/**
 * When `status` is `selected`, upsert the matching Season `drive_team` role holder.
 * Every other status is a no-op. Missing roles schema is a no-op.
 */
export async function promoteSelectedCandidateToSeasonRole(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    candidateId: string;
    status: DriverTryoutsStatus;
    seasonYear?: number;
    overallAverage?: number | null;
  },
): Promise<PromoteRoleResult> {
  if (!shouldPromoteToSeasonRole(input.status)) {
    return { status: "skipped", reason: "not_selected" };
  }
  if (!(await rolesApiExists(client))) {
    return { status: "skipped", reason: "roles_unavailable" };
  }

  const candidate = await loadCandidate(client, {
    orgId: input.orgId,
    candidateId: input.candidateId,
  });
  if (!candidate) return { status: "skipped", reason: "candidate_missing" };

  const roster = await loadRoster(client, input.orgId);
  const write = seasonRoleHolderFromCandidate(candidate, roster);
  if (!write.holderName) return { status: "skipped", reason: "empty_name" };

  const seasonYear =
    input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : candidate.seasonYear;
  const hasHolderUserId = await holderUserIdColumnExists(client);
  const holderUserId = hasHolderUserId ? write.holderUserId : null;

  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM team_roles
     WHERE org_id = $1::uuid
       AND season_year = $2
       AND lower(trim(title)) = lower(trim($3))
       AND subteam = $4
     ORDER BY created_at ASC
     LIMIT 1`,
    [input.orgId, seasonYear, write.title, DRIVE_TEAM_SUBTEAM],
  );
  const existingId = existing.rows[0]?.id;

  if (existingId) {
    if (hasHolderUserId) {
      await client.query(
        `UPDATE team_roles SET
           holder_name = $3,
           holder_user_id = $4::uuid,
           updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [existingId, input.orgId, write.holderName, holderUserId],
      );
    } else {
      await client.query(
        `UPDATE team_roles SET
           holder_name = $3,
           updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [existingId, input.orgId, write.holderName],
      );
    }
    return {
      status: "updated",
      roleId: existingId,
      title: write.title,
      holderName: write.holderName,
      holderUserId,
    };
  }

  const notes = seasonRoleSelectionNotes(input.overallAverage);
  const responsibilities = `${write.title} seat filled from driver tryouts.`;
  const inserted = hasHolderUserId
    ? await client.query<{ id: string }>(
        `INSERT INTO team_roles
           (org_id, season_year, title, subteam, holder_name, holder_user_id, is_lead, responsibilities, notes, created_by)
         VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,false,$7,$8,$9::uuid)
         RETURNING id`,
        [
          input.orgId,
          seasonYear,
          write.title,
          DRIVE_TEAM_SUBTEAM,
          write.holderName,
          holderUserId,
          responsibilities,
          notes,
          input.userId,
        ],
      )
    : await client.query<{ id: string }>(
        `INSERT INTO team_roles
           (org_id, season_year, title, subteam, holder_name, is_lead, responsibilities, notes, created_by)
         VALUES ($1::uuid,$2,$3,$4,$5,false,$6,$7,$8::uuid)
         RETURNING id`,
        [
          input.orgId,
          seasonYear,
          write.title,
          DRIVE_TEAM_SUBTEAM,
          write.holderName,
          responsibilities,
          notes,
          input.userId,
        ],
      );

  return {
    status: "created",
    roleId: inserted.rows[0]?.id ?? "",
    title: write.title,
    holderName: write.holderName,
    holderUserId,
  };
}
