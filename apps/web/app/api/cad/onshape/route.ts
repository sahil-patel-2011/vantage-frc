import { auth } from "@vantage/core";
import {
  buildOnshapeAuthorizeUrl,
  createOnshapeOAuthState,
  getOnshapeOAuthConfig,
  cadOsSupportMatrix,
} from "@vantage/cad";
import { studentOnshapeApiSetup } from "../../../../lib/cad/onshape-setup-copy";
import { createKms, encryptSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const setup = studentOnshapeApiSetup();
    const connections = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      const result = await client.query(
        `SELECT id,platform,execution_mode AS "executionMode",label,status,scopes,external_account_ref AS "externalAccountRef",
                last_tested_at AS "lastTestedAt",created_at AS "createdAt",updated_at AS "updatedAt"
         FROM cad_connections WHERE org_id=$1 AND user_id=$2 AND platform='onshape' ORDER BY updated_at DESC`,
        [orgId, session.user.id],
      );
      return result.rows;
    });
    return Response.json({
      ...setup,
      connections,
      osSupport: cadOsSupportMatrix(),
      authorizeAvailable: setup.configured,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Onshape status failed" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as { orgId?: string; action?: string };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");

    // Disconnect must keep working after the OAuth client is rotated away or
    // unset: a member who can no longer reconnect is exactly the member who
    // still needs to revoke the token Vantage is holding. So it runs before the
    // config gate rather than behind it.
    if (body.action === "disconnect") {
      const removed = await withRls({ userId: session.user.id, orgId }, async (client) => {
        const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`, [
          orgId,
          session.user.id,
        ]);
        if (!member.rowCount) throw new Error("Organization access denied");
        // The stored envelope is overwritten, not just flagged — a status column
        // alone would leave a live refresh token decryptable in the row.
        const wiped = JSON.stringify(await encryptSecret(JSON.stringify({ revoked: true }), createKms()));
        const result = await client.query(
          `UPDATE cad_connections
           SET status='disconnected', disabled_at=now(), encrypted_credentials=$3, updated_at=now()
           WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape' AND disabled_at IS NULL`,
          [orgId, session.user.id, wiped],
        );
        return result.rowCount ?? 0;
      });
      return Response.json({ success: true, removed });
    }

    const config = getOnshapeOAuthConfig();
    if (!config) {
      const setup = studentOnshapeApiSetup();
      return Response.json(
        { error: setup.message, configured: false, setupRequired: true },
        { status: 503 },
      );
    }
    await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
    });
    if (body.action === "authorize-url") {
      const state = createOnshapeOAuthState({ orgId, userId: session.user.id });
      return Response.json({ url: buildOnshapeAuthorizeUrl(config, state), expiresIn: 900 });
    }
    throw new Error("Invalid Onshape action");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Onshape request failed" },
      { status: 400 },
    );
  }
}
