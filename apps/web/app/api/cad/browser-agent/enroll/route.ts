import { createHash } from "node:crypto";
import { isEmail2faEnforced } from "@vantage/core";
import { cookies } from "next/headers";
import { z } from "zod";
import { IntelHttpError, intelSession, withIntelRequest } from "../../../../../lib/intel-auth";
import { isBrowserPilotOrgId, loadBrowserPilotAccess } from "../../../../../lib/cad/browser-pilot-access";
import { parseSecureJson, RequestSecurityError } from "../../../../../lib/security/request";

export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const enrollment = z.object({ orgId: z.string().uuid(), deviceId: z.string().uuid() }).strict();

function failed(error: unknown) {
  if (error instanceof IntelHttpError || error instanceof RequestSecurityError) {
    return Response.json({ approved: false, error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  }
  return Response.json({ approved: false, error: "Browser pilot approval could not be verified. Try again." },
    { status: 503, headers: PRIVATE_HEADERS });
}

/** Only the current member's paired Onshape computers; no credential material. */
export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isBrowserPilotOrgId(orgId)) throw new RequestSecurityError(400, "Choose a valid team.");
    const result = await withIntelRequest(orgId, async (client) => {
      const access = await loadBrowserPilotAccess(client, orgId);
      if (!access.allowed) throw new IntelHttpError(access.status === "setup_required" ? 503 : 403, access.message);
      const devices = await client.query<{ id: string; name: string }>(
        `SELECT id, machine_name AS name FROM cad_relay_devices
          WHERE org_id=$1::uuid AND user_id=current_app_user_id() AND platform='onshape'
            AND revoked_at IS NULL AND 'cad.jobs.monitor'=ANY(scopes)
          ORDER BY created_at DESC`, [orgId],
      );
      return devices.rows;
    });
    return Response.json({ devices: result }, { headers: PRIVATE_HEADERS });
  } catch (error) { return failed(error); }
}

/** Explicit browser approval, bound to the current session and current MFA proof. */
export async function POST(request: Request) {
  try {
    const body = await parseSecureJson(request, enrollment, { maxBytes: 1024 });
    const session = await intelSession();
    const rememberedToken = (await cookies()).get("vantage_mfa_device")?.value;
    const approved = await withIntelRequest(body.orgId, async (client) => {
      const access = await loadBrowserPilotAccess(client, body.orgId);
      if (!access.allowed) throw new IntelHttpError(access.status === "setup_required" ? 503 : 403, access.message);
      const result = await client.query<{ approved: boolean }>(
        "SELECT enroll_onshape_browser_pilot_device($1::uuid,$2::uuid,$3::uuid,$4,$5) AS approved",
        [body.deviceId, session.session.id, body.orgId,
          rememberedToken ? createHash("sha256").update(rememberedToken).digest("hex") : null, isEmail2faEnforced()],
      );
      return result.rows[0]?.approved === true;
    });
    if (!approved) return Response.json({ approved: false,
      error: "This computer could not be approved. Use your own active Onshape pairing and sign in with a method allowed by your team; complete authenticator verification if required." },
      { status: 403, headers: PRIVATE_HEADERS });
    return Response.json({ approved: true,
      message: "Computer approved. Pilot access will be checked again before every action and ends when this sign-in expires or is revoked." },
      { headers: PRIVATE_HEADERS });
  } catch (error) { return failed(error); }
}
