import type { PoolClient } from "@neondatabase/serverless";

export const ONSHAPE_BROWSER_PILOT_TEAM_NUMBER = 6925;
export const ONSHAPE_BROWSER_PILOT_ORG_ENV = "VANTAGE_ONSHAPE_BROWSER_PILOT_ORG_ID";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBrowserPilotOrgId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export type BrowserPilotAccess = {
  allowed: boolean;
  status: "eligible" | "setup_required" | "denied";
  reason: "pilot_member" | "pilot_not_configured" | "pilot_membership_required";
  message: string;
  transport: "onshape_browser_ui";
};

/** Eligibility is not a browser connection or permission to skip per-command checks. */
export function browserPilotAccess(input: {
  orgId: string;
  pilotOrgId: string | undefined;
  memberTeamNumber: number | null;
}): BrowserPilotAccess {
  const pilotOrgId = input.pilotOrgId?.trim();
  if (!isBrowserPilotOrgId(pilotOrgId)) {
    return {
      allowed: false, status: "setup_required", reason: "pilot_not_configured",
      message: "The Onshape browser pilot has not been enabled for the verified team yet.",
      transport: "onshape_browser_ui",
    };
  }
  if (!isBrowserPilotOrgId(input.orgId) || input.orgId.toLowerCase() !== pilotOrgId.toLowerCase() ||
    input.memberTeamNumber !== ONSHAPE_BROWSER_PILOT_TEAM_NUMBER) {
    return {
      allowed: false, status: "denied", reason: "pilot_membership_required",
      message: "The Onshape browser pilot is available to current WA Robotics Team 6925 members only.",
      transport: "onshape_browser_ui",
    };
  }
  return {
    allowed: true, status: "eligible", reason: "pilot_member",
    message: "Your team membership is eligible for the Onshape browser pilot.",
    transport: "onshape_browser_ui",
  };
}

/**
 * Call inside a session-authenticated, team-MFA-checked RLS transaction. The
 * explicit server binding prevents a different organization claiming 6925 from
 * joining the pilot. Re-read membership for each request; no allow-list snapshot
 * means newly joined members qualify and departed members lose eligibility.
 */
export async function loadBrowserPilotAccess(
  client: PoolClient,
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrowserPilotAccess> {
  const result = await client.query<{ teamNumber: number }>(
    `SELECT o.team_number AS "teamNumber"
       FROM organizations o
       JOIN memberships m ON m.org_id = o.id
      WHERE o.id = $1::uuid AND m.user_id = current_app_user_id()`,
    [orgId],
  );
  return browserPilotAccess({
    orgId,
    pilotOrgId: env[ONSHAPE_BROWSER_PILOT_ORG_ENV],
    memberTeamNumber: result.rows[0]?.teamNumber ?? null,
  });
}
