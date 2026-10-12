import { withRls } from "@vantage/db";
import { emailNewOwner } from "../../../../lib/admin-analytics/owner-notice";
import {
  AdminRouteError,
  NO_STORE,
  UUID_PATTERN,
  adminErrorResponse,
  asPlatformAdmin,
  readJsonBody,
} from "../../../../lib/admin/admin-route";
import {
  approveTeamRequest,
  declineTeamRequest,
  isPlatformOwner,
  listTeamBans,
  listTeamRequests,
  teamGovernanceRefusal,
} from "../../../../lib/admin/team-governance";
import { ensureFirstOwnerTeamDefaults } from "../../../../lib/provisioning/owner-defaults";
import { teamDisplayName } from "../../../../lib/team-lifecycle/model";

/**
 * Team requests (people asking to put an FRC team on Vantage) and the banned-team list, for the
 * Teams page of the admin console. Migration 0733 holds the rules.
 */
export async function GET() {
  try {
    const result = await asPlatformAdmin(async (client) => {
      const [requests, bans, owner] = await Promise.all([
        listTeamRequests(client),
        listTeamBans(client),
        isPlatformOwner(client),
      ]);
      return { requests, bans, isOwner: owner };
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "Team requests didn't load. Try again.", teamGovernanceRefusal);
  }
}

/** `{ requestId, decision: "approve" | "decline", reason? }` */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!UUID_PATTERN.test(requestId)) throw new AdminRouteError(400, "Choose a request from the list.");
    const decision = body.decision === "approve" ? "approve" : body.decision === "decline" ? "decline" : null;
    if (!decision) throw new AdminRouteError(400, "Choose approve or decline.");
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

    if (decision === "decline") {
      await asPlatformAdmin((client) => declineTeamRequest(client, requestId, reason));
      return Response.json({ declined: requestId }, { headers: NO_STORE });
    }

    const approved = await asPlatformAdmin((client, session) => approveTeamRequest(client, session.user.id, requestId));
    const teamLabel = teamDisplayName({ teamNumber: approved.teamNumber, name: approved.teamName });
    // The same start an admin-created team gets, written as its new owner once the team is
    // committed. It never undoes the approval if it fails; Home offers it again.
    if (approved.created) {
      await withRls({ userId: approved.ownerUserId, orgId: approved.orgId }, (client) =>
        ensureFirstOwnerTeamDefaults(client, approved.orgId, approved.ownerUserId),
      ).catch(() => null);
    }
    const notice = await emailNewOwner({ email: approved.ownerEmail, teamLabel, orgId: approved.orgId }).catch(() => ({
      emailSent: false,
      delivery: "failed" as const,
    }));
    return Response.json(
      { approved: requestId, orgId: approved.orgId, created: approved.created, teamLabel, emailSent: notice.emailSent },
      { headers: NO_STORE },
    );
  } catch (error) {
    return adminErrorResponse(error, "Nothing changed. Try again in a minute.", teamGovernanceRefusal);
  }
}
