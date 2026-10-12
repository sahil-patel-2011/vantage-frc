import { NO_STORE, adminErrorResponse, asPlatformAdmin, readJsonBody } from "../../../../lib/admin/admin-route";
import {
  banTeam,
  liftTeamBan,
  parseBanReason,
  parseTeamNumber,
  teamGovernanceRefusal,
} from "../../../../lib/admin/team-governance";

/**
 * Ban an FRC team number (POST) or lift a ban (DELETE). The platform owner only, with a sign-in
 * from the last 24 hours: a ban locks a whole team out. Migration 0733 enforces the owner rule.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const teamNumber = parseTeamNumber(body.teamNumber);
    const reason = parseBanReason(body.reason);
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : null;
    await asPlatformAdmin((client) => banTeam(client, teamNumber, reason, note), { fresh: true });
    return Response.json({ banned: teamNumber }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The ban wasn't saved. Try again in a minute.", teamGovernanceRefusal);
  }
}

/** `{ teamNumber }` */
export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody(request);
    const teamNumber = parseTeamNumber(body.teamNumber);
    await asPlatformAdmin((client) => liftTeamBan(client, teamNumber), { fresh: true });
    return Response.json({ lifted: teamNumber }, { headers: NO_STORE });
  } catch (error) {
    return adminErrorResponse(error, "The ban is still in place. Try again in a minute.", teamGovernanceRefusal);
  }
}
