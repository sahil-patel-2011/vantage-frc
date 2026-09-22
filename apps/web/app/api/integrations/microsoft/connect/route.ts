import { withRls } from "@vantage/db";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { buildMicrosoftAuthorizeUrl, getMicrosoftConfig } from "../../../../../lib/microsoft/graph";
import {
  createMicrosoftOAuthState,
  pkceVerifierForNonce,
  verifyMicrosoftOAuthState,
} from "../../../../../lib/microsoft/oauth-state";
import { appBaseUrl, connectorsRedirect, currentUser } from "../../../../../lib/microsoft/route-helpers";

/**
 * GET /api/integrations/microsoft/connect?orgId=…
 *
 * Owner/admin only (checked here, server-side, before anything is sent to Microsoft).
 * Redirects to Microsoft's authorize endpoint with a signed state bound to this user and
 * team, and a PKCE challenge derived from that state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appBaseUrl(url);
  const orgId = url.searchParams.get("orgId");

  const user = await currentUser();
  if (!user) {
    const next = `/api/integrations/microsoft/connect?${url.searchParams.toString()}`;
    return Response.redirect(`${base}/signin?next=${encodeURIComponent(next)}`, 303);
  }
  if (!isUuid(orgId)) return connectorsRedirect(base, null, "error", "invalid_team");

  const config = getMicrosoftConfig();
  if (!config) return connectorsRedirect(base, orgId, "error", "setup_required");

  try {
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
  } catch (error) {
    const reason = error instanceof HttpError ? error.code : "failed";
    return connectorsRedirect(base, orgId, "error", reason);
  }

  let state: string;
  let verifier: string;
  try {
    state = createMicrosoftOAuthState({ orgId, userId: user.id });
    verifier = pkceVerifierForNonce(verifyMicrosoftOAuthState(state).nonce);
  } catch {
    // Production without BETTER_AUTH_SECRET: refuse rather than sign with a guessable key.
    return connectorsRedirect(base, orgId, "error", "setup_required");
  }
  return Response.redirect(buildMicrosoftAuthorizeUrl(config, state, verifier), 302);
}
