import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  exchangeGitHubCode,
  getGitHubOAuthConfig,
  requireOrgAdmin,
  upsertGitHubConnection,
  verifyGitHubOAuthState,
} from "../../../../../lib/github";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const base = (process.env.BETTER_AUTH_URL ?? url.origin).replace(/\/$/, "");

  if (oauthError) {
    return Response.redirect(
      `${base}/team?github=denied&error=${encodeURIComponent(oauthError)}`,
    );
  }
  if (!code || !state) {
    return Response.redirect(`${base}/team?github=error&error=missing_code`);
  }

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      const next = `/api/github/oauth/callback?${url.searchParams.toString()}`;
      return Response.redirect(`${base}/signin?next=${encodeURIComponent(next)}`);
    }
    const claims = verifyGitHubOAuthState(state);
    if (claims.userId !== session.user.id) throw new Error("OAuth state user mismatch");
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("GitHub OAuth is not configured");
    const tokens = await exchangeGitHubCode(config, code);

    await withRls({ userId: session.user.id, orgId: claims.orgId }, async (client) => {
      await requireOrgAdmin(client, claims.orgId, session.user.id);
      await upsertGitHubConnection(client, {
        orgId: claims.orgId,
        userId: session.user.id,
        authMethod: "oauth",
        tokens,
        scopes: config.scopes,
        label: "GitHub OAuth",
      });
    });

    return Response.redirect(
      `${base}/team?orgId=${encodeURIComponent(claims.orgId)}&github=connected#github-connection`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return Response.redirect(`${base}/team?github=error&error=${encodeURIComponent(message)}`);
  }
}
