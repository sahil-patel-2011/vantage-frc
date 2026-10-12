import type { PoolClient } from "@neondatabase/serverless";
import { createOrganizationAsPlatformAdmin } from "@vantage/core";
import { AdminRouteError } from "./admin-route";

/**
 * Team requests and team bans for the platform admin console (migration 0733).
 *
 * - A team request is someone asking to put an FRC team on Vantage (or to lead one nobody leads
 *   yet). Approving creates the team with them as its owner; declining tells them why.
 * - A ban bars a team number for breaking the Terms of Service or Privacy Policy. Only the
 *   platform owner bans or lifts a ban; the database enforces it too.
 */

import {
  BAN_REASONS,
  type BanReason,
  type TeamBan,
  type TeamRequest,
} from "./team-governance-model";

export * from "./team-governance-model";

const REFUSALS: Record<string, { status: number; message: string }> = {
  not_platform_admin: { status: 404, message: "Not found" },
  owner_only: { status: 403, message: "Only the platform owner can ban a team or lift a ban." },
  team_banned: { status: 409, message: "That team is banned. Lift the ban before approving it." },
  team_exists: { status: 409, message: "That team is already on Vantage with an owner." },
  request_missing: { status: 404, message: "That request is gone. Refresh the list." },
  request_closed: { status: 409, message: "Someone already handled that request. Refresh the list." },
  bad_team_number: { status: 400, message: "Enter an FRC team number between 1 and 99999." },
  bad_reason: { status: 400, message: "Choose why the team is banned." },
  note_too_long: { status: 400, message: "Keep the note to 1000 characters." },
  reason_too_long: { status: 400, message: "Keep the reason to 500 characters." },
  not_banned: { status: 404, message: "That team isn't banned. Refresh the list." },
  org_required: { status: 409, message: "The team has to exist before the request can be approved." },
  org_mismatch: { status: 409, message: "That team doesn't match the request." },
  bad_decision: { status: 400, message: "Choose approve or decline." },
};

/** A refusal from the 0733 functions, as a sentence. */
export function teamGovernanceRefusal(error: unknown): AdminRouteError | null {
  if (!error || typeof error !== "object") return null;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42883" || code === "42P01") {
    return new AdminRouteError(503, "Team requests and bans need database migration 0733. Run the migrations, then try again.", "setup_required");
  }
  const detail = "detail" in error ? String((error as { detail?: unknown }).detail ?? "") : "";
  const match = /^vantage:([a-z_]+)$/.exec(detail);
  const mapped = match ? REFUSALS[match[1]!] : undefined;
  return mapped ? new AdminRouteError(mapped.status, mapped.message, match![1]) : null;
}

export async function listTeamRequests(client: PoolClient): Promise<TeamRequest[]> {
  const result = await client.query<TeamRequest>(
    `SELECT id, team_number AS "teamNumber", team_name AS "teamName", status, org_id AS "orgId",
            requester_id AS "requesterId", requester_name AS "requesterName", requester_email AS "requesterEmail",
            requested_team_role AS "requestedTeamRole", crew_role AS "crewRole", role_description AS "roleDescription",
            decline_reason AS "declineReason", created_at::text AS "createdAt", updated_at::text AS "updatedAt",
            reviewed_at::text AS "reviewedAt"
       FROM team_setup_request_list()`,
  );
  return result.rows;
}

export async function listTeamBans(client: PoolClient): Promise<TeamBan[]> {
  const result = await client.query<TeamBan>(
    `SELECT b.team_number AS "teamNumber", b.reason, b.note, b.banned_at::text AS "bannedAt",
            u.email AS "bannedByEmail", o.name AS "orgName",
            COALESCE((SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id), 0) AS "memberCount"
       FROM team_bans b
       LEFT JOIN users u ON u.id = b.banned_by
       LEFT JOIN organizations o ON o.team_number = b.team_number
      ORDER BY b.banned_at DESC`,
  );
  return result.rows;
}

export async function isPlatformOwner(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ owner: boolean }>(`SELECT is_platform_owner() AS owner`);
  return result.rows[0]?.owner === true;
}

export function parseTeamNumber(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(number) || number < 1 || number > 99999) {
    throw new AdminRouteError(400, REFUSALS.bad_team_number!.message, "bad_team_number");
  }
  return number;
}

export function parseBanReason(value: unknown): BanReason {
  if (typeof value === "string" && (BAN_REASONS as readonly string[]).includes(value)) return value as BanReason;
  throw new AdminRouteError(400, REFUSALS.bad_reason!.message, "bad_reason");
}

/** "Team 7777" style names get a web address like team-7777; anything else is slugged. */
export function teamSlug(name: string, teamNumber: number): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const withNumber = base.includes(String(teamNumber)) ? base : `${base ? `${base}-` : "team-"}${teamNumber}`;
  return withNumber || `team-${teamNumber}`;
}

/** The team's name: what the requester typed, else The Blue Alliance's nickname, else "Team N". */
async function teamNameFor(client: PoolClient, request: { teamNumber: number; teamName: string | null }) {
  if (request.teamName?.trim()) return request.teamName.trim();
  const ref = await client.query<{ nickname: string | null }>(
    `SELECT nickname FROM teams_ref WHERE team_number = $1::int LIMIT 1`,
    [request.teamNumber],
  );
  const nickname = ref.rows[0]?.nickname?.trim();
  return nickname && nickname.length >= 2 ? nickname.slice(0, 80) : `Team ${request.teamNumber}`;
}

async function freeSlug(client: PoolClient, wanted: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? wanted : `${wanted}-${attempt + 1}`;
    const taken = await client.query(`SELECT 1 FROM organizations WHERE slug = $1 LIMIT 1`, [candidate]);
    if (!taken.rowCount) return candidate;
  }
  throw new AdminRouteError(409, "Couldn't pick a web address for the team. Add it from Add a team instead.", "slug_taken");
}

export type ApprovedTeam = {
  orgId: string;
  created: boolean;
  teamNumber: number;
  teamName: string;
  ownerUserId: string;
  ownerEmail: string;
};

/**
 * Approve a request: create the team as the platform admin with the requester as owner (or, for
 * a team that exists but has nobody leading it, make them its owner), then record the decision.
 * One transaction: the team never exists without its decision, or the other way round.
 */
export async function approveTeamRequest(client: PoolClient, actorUserId: string, requestId: string): Promise<ApprovedTeam> {
  const found = await client.query<Pick<TeamRequest, "teamNumber" | "teamName" | "status" | "orgId" | "requesterId" | "requesterEmail">>(
    `SELECT r.team_number AS "teamNumber", r.team_name AS "teamName", r.status, r.org_id AS "orgId",
            r.user_id AS "requesterId", u.email AS "requesterEmail"
       FROM team_setup_requests r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = $1::uuid`,
    [requestId],
  );
  const request = found.rows[0];
  if (!request) throw new AdminRouteError(404, REFUSALS.request_missing!.message, "request_missing");
  if (request.status !== "pending") throw new AdminRouteError(409, REFUSALS.request_closed!.message, "request_closed");

  let orgId = request.orgId;
  let created = false;
  let teamName = request.teamName ?? `Team ${request.teamNumber}`;
  if (!orgId) {
    // Someone may have set the team up since the request came in.
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM organizations WHERE team_number = $1::int LIMIT 1`,
      [request.teamNumber],
    );
    if (existing.rows[0]) {
      orgId = existing.rows[0].id;
      teamName = existing.rows[0].name;
    } else {
      teamName = await teamNameFor(client, request);
      const slug = await freeSlug(client, teamSlug(teamName, request.teamNumber));
      orgId = await createOrganizationAsPlatformAdmin(client, actorUserId, {
        name: teamName,
        slug,
        teamNumber: request.teamNumber,
        ownerEmail: request.requesterEmail,
      });
      created = true;
    }
  } else {
    const existing = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1::uuid`, [orgId]);
    teamName = existing.rows[0]?.name ?? teamName;
  }
  await client.query(`SELECT review_team_setup_request($1::uuid, 'approve', $2::uuid, NULL)`, [requestId, orgId]);
  return {
    orgId,
    created,
    teamNumber: request.teamNumber,
    teamName,
    ownerUserId: request.requesterId,
    ownerEmail: request.requesterEmail,
  };
}

export async function declineTeamRequest(client: PoolClient, requestId: string, reason: string | null) {
  await client.query(`SELECT review_team_setup_request($1::uuid, 'decline', NULL, $2::text)`, [requestId, reason]);
}

export async function banTeam(client: PoolClient, teamNumber: number, reason: BanReason, note: string | null) {
  await client.query(`SELECT team_ban_set($1::int, $2::text, $3::text)`, [teamNumber, reason, note]);
}

export async function liftTeamBan(client: PoolClient, teamNumber: number) {
  await client.query(`SELECT team_ban_lift($1::int)`, [teamNumber]);
}
