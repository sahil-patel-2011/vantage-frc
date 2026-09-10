import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getCadRelayPool } from "@vantage/db/cad-relay";
import { headers } from "next/headers";
import { buildAgentConfigBundle } from "../../../../lib/agent-config/store";
import { buildCursorExport } from "../../../../lib/agent-config/cursor-formats";

/**
 * GET /api/agent-config/bundle — the typed team agent-config bundle
 * (shape documented in docs/AGENT_CONFIG.md). Two auth paths, both org-scoped:
 *
 * 1. Browser session (custom agents / curl with cookies): ?orgId= optional,
 *    membership resolved under RLS.
 * 2. Paired device token from `vantage-cad setup` (Bearer), exactly like the
 *    other CLI routes: the token's own org and user — no org override.
 *
 * The bundle is scoped to the requesting USER, not just the org (migration
 * 0490): team-wide items plus 'members'-restricted items the user created or
 * was granted. Owners/admins get the same treatment — management visibility
 * in the UI does not put other people's restricted items in their bundle.
 *
 * `?format=cursor` returns the same scoped content materialized as
 * Cursor-native files (.cursor/rules/vantage/*.mdc, .cursor/skills, and the
 * mcpServers entries for .cursor/mcp.json) for tooling that wants files
 * instead of the typed bundle.
 */
export async function GET(request: Request) {
  try {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    let orgId: string | null = null;

    if (bearer) {
      const device = await getCadRelayPool().query<{ orgId: string; userId: string }>(
        `SELECT org_id AS "orgId", user_id AS "userId"
         FROM cad_relay_devices
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [createHash("sha256").update(bearer).digest("hex")],
      );
      if (!device.rows[0]) {
        return Response.json({ error: "Device token is invalid or revoked" }, { status: 401 });
      }
      userId = device.rows[0].userId;
      orgId = device.rows[0].orgId;
    } else {
      const session = await auth.api.getSession({ headers: await headers() });
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      userId = session.user.id;
      orgId = new URL(request.url).searchParams.get("orgId");
    }

    const bundle = await withRls({ userId, ...(orgId ? { orgId } : {}) }, async (client) => {
      const membership = await client.query<{ orgId: string }>(
        `SELECT m.org_id AS "orgId"
         FROM memberships m
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
         LIMIT 1`,
        [userId, orgId],
      );
      const resolved = membership.rows[0]?.orgId;
      if (!resolved) return null;
      return buildAgentConfigBundle(client, resolved, userId);
    });

    if (!bundle) {
      return Response.json(
        { error: "No team found for this account", status: "setup_required" },
        { status: 404 },
      );
    }
    if (new URL(request.url).searchParams.get("format") === "cursor") {
      const cursor = buildCursorExport(bundle);
      return Response.json({
        schema: "vantage.agent-config.cursor/v1",
        orgId: bundle.orgId,
        generatedAt: bundle.generatedAt,
        ...cursor,
      });
    }
    return Response.json(bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bundle request failed";
    // Missing migration/table degrades to a clear setup state, never a crash.
    if (/agent_config_items/.test(message)) {
      return Response.json(
        { error: "Agent config is not set up yet (migration 0487)", status: "setup_required" },
        { status: 503 },
      );
    }
    return Response.json({ error: message }, { status: 400 });
  }
}
