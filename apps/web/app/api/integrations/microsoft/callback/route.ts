import { withRls } from "@vantage/db";
import { aiKeysEncryptionStatus } from "../../../../../lib/ai-keys/kms-status";
import { HttpError, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { encryptRefreshToken, isMissingRelation, readWorkbookNaming, saveConnection } from "../../../../../lib/microsoft/connection-store";
import { GraphClient, exchangeMicrosoftCode, getMicrosoftConfig, isGraphError } from "../../../../../lib/microsoft/graph";
import { OAuthStateError, pkceVerifierForNonce, verifyMicrosoftOAuthState } from "../../../../../lib/microsoft/oauth-state";
import { appBaseUrl, connectorsRedirect, currentUser } from "../../../../../lib/microsoft/route-helpers";
import { ensureWorkbookFile, readMicrosoftAccount, workbookFileName } from "../../../../../lib/microsoft/workbook-target";

export const maxDuration = 60;

/**
 * GET /api/integrations/microsoft/callback?code=…&state=…
 *
 * 1. The state must verify (HMAC, 15-minute expiry, purpose) and name the signed-in user.
 * 2. The user must still be an owner/admin of the team in the state.
 * 3. Exchange the code (with the PKCE verifier only this server can derive).
 * 4. Find or create /Vantage/Vantage – Team <n>.xlsx in the connected OneDrive.
 * 5. Store the refresh token envelope-encrypted; redirect back to Connectors.
 *
 * Every failure redirects with a short reason code — never raw upstream text, never a token.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appBaseUrl(url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    // e.g. access_denied when the admin cancels the Microsoft consent screen.
    return connectorsRedirect(base, null, "error", url.searchParams.get("error") === "access_denied" ? "denied" : "microsoft");
  }
  if (!code || !state) return connectorsRedirect(base, null, "error", "missing_code");

  const user = await currentUser();
  if (!user) {
    const next = `/api/integrations/microsoft/callback?${url.searchParams.toString()}`;
    return Response.redirect(`${base}/signin?next=${encodeURIComponent(next)}`, 303);
  }

  let claims: { orgId: string; userId: string; nonce: string };
  try {
    claims = verifyMicrosoftOAuthState(state);
  } catch (error) {
    return connectorsRedirect(base, null, "error", error instanceof OAuthStateError && error.reason === "expired" ? "state_expired" : "state");
  }
  if (claims.userId !== user.id) return connectorsRedirect(base, claims.orgId, "error", "state");

  const config = getMicrosoftConfig();
  if (!config) return connectorsRedirect(base, claims.orgId, "error", "setup_required");
  if (!aiKeysEncryptionStatus().ok) return connectorsRedirect(base, claims.orgId, "error", "encryption");

  try {
    const naming = await withRls({ userId: user.id, orgId: claims.orgId }, async (client) => {
      await requireWorkbookManager(client, claims.orgId, user.id);
      return readWorkbookNaming(client, claims.orgId);
    });

    const tokens = await exchangeMicrosoftCode(config, code, pkceVerifierForNonce(claims.nonce));
    if (!tokens.refreshToken) return connectorsRedirect(base, claims.orgId, "error", "no_offline_access");

    const graph = new GraphClient(tokens.accessToken);
    const account = await readMicrosoftAccount(graph);
    const workbook = await ensureWorkbookFile(graph, workbookFileName(naming));
    const encrypted = await encryptRefreshToken(tokens.refreshToken);

    await withRls({ userId: user.id, orgId: claims.orgId }, async (client) => {
      // Re-checked in the write transaction: the role could have changed during the round trip.
      await requireWorkbookManager(client, claims.orgId, user.id);
      await saveConnection(client, { orgId: claims.orgId, userId: user.id, refreshToken: encrypted, account, workbook });
    });
    return connectorsRedirect(base, claims.orgId, "connected");
  } catch (error) {
    if (error instanceof HttpError) return connectorsRedirect(base, claims.orgId, "error", error.code);
    if (isMissingRelation(error)) return connectorsRedirect(base, claims.orgId, "error", "not_migrated");
    if (isGraphError(error)) {
      console.error("[microsoft-excel] connect failed", error.kind, error.status, error.code);
      return connectorsRedirect(base, claims.orgId, "error", error.kind === "auth_expired" ? "denied" : "microsoft");
    }
    console.error("[microsoft-excel] connect failed", error instanceof Error ? error.name : typeof error);
    return connectorsRedirect(base, claims.orgId, "error", "failed");
  }
}
