import { auth } from "@vantage/core";
import {
  exchangeOnshapeCode,
  getOnshapeOAuthConfig,
  verifyOnshapeOAuthState,
} from "@vantage/cad";
import { createKms, encryptSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const base = (process.env.BETTER_AUTH_URL ?? url.origin).replace(/\/$/, "");

  if (oauthError) {
    return Response.redirect(
      `${base}/cad/connections?onshape=denied&error=${encodeURIComponent(oauthError)}`,
    );
  }
  if (!code || !state) {
    return Response.redirect(`${base}/cad/connections?onshape=error&error=missing_code`);
  }

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      const next = `/api/cad/onshape/oauth/callback?${url.searchParams.toString()}`;
      return Response.redirect(`${base}/signin?next=${encodeURIComponent(next)}`);
    }
    const claims = verifyOnshapeOAuthState(state);
    if (claims.userId !== session.user.id) throw new Error("OAuth state user mismatch");
    const config = getOnshapeOAuthConfig();
    if (!config) throw new Error("Onshape OAuth is not configured");
    const tokens = await exchangeOnshapeCode(config, code);
    const encrypted = await encryptSecret(JSON.stringify(tokens), createKms());
    const payload = JSON.stringify(encrypted);

    await withRls({ userId: session.user.id, orgId: claims.orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        claims.orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM cad_connections WHERE org_id=$1 AND user_id=$2 AND platform='onshape' AND disabled_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [claims.orgId, session.user.id],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE cad_connections
           SET encrypted_credentials=$3,scopes=$4,status='connected',label='Onshape OAuth',
               external_account_ref=$5,disabled_at=NULL,last_tested_at=now(),updated_at=now()
           WHERE id=$1 AND org_id=$2`,
          [existing.rows[0].id, claims.orgId, payload, config.scopes, `onshape:${session.user.id}`],
        );
      } else {
        await client.query(
          `INSERT INTO cad_connections(org_id,user_id,platform,execution_mode,label,encrypted_credentials,scopes,status,external_account_ref,last_tested_at)
           VALUES($1,$2,'onshape','hosted','Onshape OAuth',$3,$4,'connected',$5,now())`,
          [claims.orgId, session.user.id, payload, config.scopes, `onshape:${session.user.id}`],
        );
      }
    });

    return Response.redirect(
      `${base}/cad/connections?orgId=${encodeURIComponent(claims.orgId)}&onshape=connected`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return Response.redirect(
      `${base}/cad/connections?onshape=error&error=${encodeURIComponent(message)}`,
    );
  }
}
