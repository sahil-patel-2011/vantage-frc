import { auth } from "@vantage/core";
import {
  buildOnshapeAuthorizeUrl,
  createOnshapeOAuthState,
  getOnshapeOAuthConfig,
  onshapeSetupStatus,
  cadOsSupportMatrix,
} from "@vantage/cad";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const setup = onshapeSetupStatus();
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
    const config = getOnshapeOAuthConfig();
    if (!config) {
      return Response.json(
        { error: "Onshape OAuth is not configured", ...onshapeSetupStatus() },
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
