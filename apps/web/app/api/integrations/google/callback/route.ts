import { withRls } from "@vantage/db";
import { aiKeysEncryptionStatus } from "../../../../../lib/ai-keys/kms-status";
import { isMirrorNotMigrated, saveGoogleConnection } from "../../../../../lib/google-sheets/connection-store";
import {
  GoogleSheetsClient,
  exchangeGoogleCode,
  getGoogleSheetsConfig,
  isGoogleSheetsError,
  readGoogleAccount,
} from "../../../../../lib/google-sheets/google-api";
import { GoogleOAuthStateError, googlePkceVerifier, verifyGoogleOAuthState } from "../../../../../lib/google-sheets/oauth-state";
import { googleConnectorsRedirect } from "../../../../../lib/google-sheets/route-helpers";
import { createSpreadsheet } from "../../../../../lib/google-sheets/sheets-target";
import { HttpError, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { encryptRefreshToken, readWorkbookNaming } from "../../../../../lib/microsoft/connection-store";
import { resolveAuthBaseURL } from "@vantage/core";
import { currentUser } from "../../../../../lib/microsoft/route-helpers";
import { workbookFileName } from "../../../../../lib/microsoft/workbook-target";

export const maxDuration = 60;

/**
 * GET /api/integrations/google/callback?code=…&state=…
 *
 * 1. The state must verify (HMAC, 15-minute expiry, purpose). It names the user and team.
 *    A signed-in session that belongs to someone else is refused; no session at all is
 *    allowed, because Google may return to a different Vantage host than the one the
 *    owner started on, where they have no cookie — the signed state is the proof instead.
 * 2. That user must still be an owner/admin of that team (checked twice: before and in
 *    the write transaction).
 * 3. Exchange the code with the PKCE verifier only this server can derive.
 * 4. Create the team's spreadsheet (drive.file: Vantage can only edit files it made).
 * 5. Store the refresh token envelope-encrypted; redirect back to Connectors.
 *
 * Every failure redirects with a short reason code — never upstream text, never a token.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Back to the canonical app host, not the callback host: Google returns to the registered
  // sign-in origin, where the owner usually has no session.
  const base = resolveAuthBaseURL();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (url.searchParams.get("error")) {
    return googleConnectorsRedirect(base, null, "error", url.searchParams.get("error") === "access_denied" ? "denied" : "google");
  }
  if (!code || !state) return googleConnectorsRedirect(base, null, "error", "missing_code");

  let claims: { orgId: string; userId: string; nonce: string };
  try {
    claims = verifyGoogleOAuthState(state);
  } catch (error) {
    return googleConnectorsRedirect(
      base,
      null,
      "error",
      error instanceof GoogleOAuthStateError && error.reason === "expired" ? "state_expired" : "state",
    );
  }
  const user = await currentUser();
  if (user && user.id !== claims.userId) return googleConnectorsRedirect(base, claims.orgId, "error", "state");

  const config = getGoogleSheetsConfig();
  if (!config) return googleConnectorsRedirect(base, claims.orgId, "error", "setup_required");
  if (!aiKeysEncryptionStatus().ok) return googleConnectorsRedirect(base, claims.orgId, "error", "encryption");

  const scope = { userId: claims.userId, orgId: claims.orgId };
  try {
    const naming = await withRls(scope, async (client) => {
      await requireWorkbookManager(client, claims.orgId, claims.userId);
      return readWorkbookNaming(client, claims.orgId);
    });

    const tokens = await exchangeGoogleCode(config, code, googlePkceVerifier(claims.nonce));
    if (!tokens.refreshToken) return googleConnectorsRedirect(base, claims.orgId, "error", "no_offline_access");

    const sheets = new GoogleSheetsClient(tokens.accessToken);
    const account = await readGoogleAccount(sheets);
    const spreadsheet = await createSpreadsheet(sheets, workbookFileName(naming).replace(/\.xlsx$/i, ""));
    const encrypted = await encryptRefreshToken(tokens.refreshToken);

    await withRls(scope, async (client) => {
      await requireWorkbookManager(client, claims.orgId, claims.userId);
      await saveGoogleConnection(client, {
        orgId: claims.orgId,
        userId: claims.userId,
        refreshToken: encrypted,
        account,
        spreadsheet,
      });
    });
    return googleConnectorsRedirect(base, claims.orgId, "connected");
  } catch (error) {
    if (error instanceof HttpError) return googleConnectorsRedirect(base, claims.orgId, "error", error.code);
    if (isMirrorNotMigrated(error)) return googleConnectorsRedirect(base, claims.orgId, "error", "not_migrated");
    if (isGoogleSheetsError(error)) {
      console.error("[google-sheets] connect failed", error.kind, error.status, error.code);
      const reason = error.kind === "auth_expired" ? "denied" : error.kind === "api_disabled" ? "api_disabled" : "google";
      return googleConnectorsRedirect(base, claims.orgId, "error", reason);
    }
    console.error("[google-sheets] connect failed", error instanceof Error ? error.name : typeof error);
    return googleConnectorsRedirect(base, claims.orgId, "error", "failed");
  }
}
