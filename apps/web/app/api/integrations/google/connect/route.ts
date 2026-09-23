import { withRls } from "@vantage/db";
import { buildGoogleAuthorizeUrl, getGoogleSheetsConfig, googleSheetsSetupStatus } from "../../../../../lib/google-sheets/google-api";
import {
  createGoogleOAuthState,
  googlePkceChallenge,
  googlePkceVerifier,
  verifyGoogleOAuthState,
} from "../../../../../lib/google-sheets/oauth-state";
import { googleConnectorsRedirect } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { appBaseUrl, currentUser } from "../../../../../lib/microsoft/route-helpers";

/**
 * GET /api/integrations/google/connect?orgId=…  — owner/admin.
 *
 * Checks the role server-side, then sends the owner to Google's consent screen with a
 * signed state bound to them and this team, and a PKCE challenge derived from that state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appBaseUrl(url);
  const orgId = url.searchParams.get("orgId");

  const user = await currentUser();
  if (!user) {
    const next = `/api/integrations/google/connect?${url.searchParams.toString()}`;
    return Response.redirect(`${base}/signin?next=${encodeURIComponent(next)}`, 303);
  }
  if (!isUuid(orgId)) return googleConnectorsRedirect(base, null, "error", "invalid_team");

  const config = getGoogleSheetsConfig();
  if (!config || !googleSheetsSetupStatus().oauthOffered) return googleConnectorsRedirect(base, orgId, "error", "use_apps_script");

  try {
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
  } catch (error) {
    return googleConnectorsRedirect(base, orgId, "error", error instanceof HttpError ? error.code : "failed");
  }

  let state: string;
  let challenge: string;
  try {
    state = createGoogleOAuthState({ orgId, userId: user.id });
    challenge = googlePkceChallenge(googlePkceVerifier(verifyGoogleOAuthState(state).nonce));
  } catch {
    // Production without BETTER_AUTH_SECRET: refuse rather than sign with a guessable key.
    return googleConnectorsRedirect(base, orgId, "error", "setup_required");
  }
  return Response.redirect(buildGoogleAuthorizeUrl(config, state, challenge), 302);
}
