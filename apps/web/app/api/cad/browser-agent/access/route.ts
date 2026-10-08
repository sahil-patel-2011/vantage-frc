import { createHash } from "node:crypto";
import { isEmail2faEnforced } from "@vantage/core";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { IntelHttpError, withIntelRequest } from "../../../../../lib/intel-auth";
import { isBrowserPilotOrgId, loadBrowserPilotAccess, ONSHAPE_BROWSER_PILOT_ORG_ENV } from "../../../../../lib/cad/browser-pilot-access";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

/** Read-only eligibility probe. It neither calls Onshape nor issues an execution credential. */
export async function GET(request: Request) {
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!isBrowserPilotOrgId(orgId)) {
    return Response.json({ allowed: false, status: "invalid_request", error: "Choose a valid team." },
      { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    const access = await withIntelRequest(orgId, (client) => loadBrowserPilotAccess(client, orgId));
    return Response.json(access, {
      status: access.allowed ? 200 : access.status === "setup_required" ? 503 : 403,
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    if (error instanceof IntelHttpError) {
      return Response.json({
        allowed: false, status: "denied",
        error: error.status === 401 ? "Sign in to check Onshape browser pilot access." :
          "Team access is unavailable. Check your membership and team sign-in requirements.",
      }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    return Response.json({ allowed: false, status: "unavailable", error: "Pilot access could not be verified. Try again." },
      { status: 503, headers: PRIVATE_HEADERS });
  }
}

/** Paired desktop/CLI device probe. Team and actor come only from the token row. */
export async function POST(request: Request) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) {
    return Response.json({ allowed: false, status: "denied", reason: "device_invalid", error: "Pair this computer with Vantage to check pilot access." },
      { status: 401, headers: PRIVATE_HEADERS });
  }
  const pilotOrgId = process.env[ONSHAPE_BROWSER_PILOT_ORG_ENV]?.trim();
  if (!isBrowserPilotOrgId(pilotOrgId)) {
    return Response.json({ allowed: false, status: "setup_required", reason: "pilot_not_configured",
      message: "The Onshape browser pilot has not been enabled for the verified team yet.", transport: "onshape_browser_ui" },
      { status: 503, headers: PRIVATE_HEADERS });
  }
  try {
    // The body/query cannot choose another org or user. The SECURITY DEFINER
    // function exposes no row data and verifies current membership and policy.
    const result = await getCadRelayPool().query<{ allowed: boolean; status: string; reason: string }>(
      "SELECT allowed, status, reason FROM check_onshape_browser_pilot_device($1, $2::uuid, $3)",
      [createHash("sha256").update(token).digest("hex"), pilotOrgId, isEmail2faEnforced()],
    );
    const access = result.rows[0];
    if (access?.allowed === true && access.status === "eligible" && access.reason === "pilot_member") {
      return Response.json({ allowed: true, status: "eligible", reason: "pilot_member", transport: "onshape_browser_ui",
        message: "Your paired computer is eligible for the Onshape browser pilot." }, { headers: PRIVATE_HEADERS });
    }
    if (access?.reason === "device_invalid") {
      return Response.json({ allowed: false, status: "denied", reason: "device_invalid", error: "The Onshape device pairing is invalid or revoked. Pair this computer again." },
        { status: 401, headers: PRIVATE_HEADERS });
    }
    if (access?.reason === "team_sign_in_required") {
      return Response.json({ allowed: false, status: "denied", reason: "team_sign_in_required",
        error: "Approve this paired computer from Vantage's Onshape browser pilot using a current team sign-in, then try again." },
        { status: 403, headers: PRIVATE_HEADERS });
    }
    if (access?.reason === "pilot_membership_required") {
      return Response.json({ allowed: false, status: "denied", reason: "pilot_membership_required",
        error: "The Onshape browser pilot is available to current WA Robotics Team 6925 members only." },
        { status: 403, headers: PRIVATE_HEADERS });
    }
    throw new Error("Unconfirmed pilot access");
  } catch {
    return Response.json({ allowed: false, status: "unavailable", error: "Pilot access could not be verified. Try again." },
      { status: 503, headers: PRIVATE_HEADERS });
  }
}
