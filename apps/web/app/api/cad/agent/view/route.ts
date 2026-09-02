import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { isoShadedViewPath, onshapeSetupStatus, readOnshapeJson } from "@vantage/cad";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadCadAgentSession } from "../../../../../lib/cad/cad-agent-session";
import { loadCadAgentOnshape, onshapeAvailability } from "../../../../../lib/cad/onshape-tokens";

export const dynamic = "force-dynamic";

/**
 * The CAD viewport. Onshape refuses to be framed, so instead of an iframe the
 * client shows this PNG: one server-side call to Onshape's shaded-view endpoint
 * for the org's bound Part Studio, through the caller's own (or team) connection.
 *
 *  - 401 not signed in · 403 not a member · 404 nothing bound
 *  - 503 setup_required when there is no Onshape connection to render with
 *  - 502 with Onshape's message when the render itself fails
 *
 * Never cached: every tool call changes the model, and the client re-requests
 * after each one (and on the manual Refresh button).
 */

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function jsonError(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: NO_STORE });
}

async function assertMember(client: PoolClient, orgId: string, userId: string) {
  const member = await client.query(`SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`, [
    orgId,
    userId,
  ]);
  return Boolean(member.rowCount);
}

function clampPx(raw: string | null, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(2000, Math.max(32, Math.round(value)));
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return jsonError(401, { error: "Authentication required" });
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) return jsonError(400, { error: "orgId is required" });
  const widthPx = clampPx(url.searchParams.get("w"), 900);
  const heightPx = clampPx(url.searchParams.get("h"), 700);

  try {
    const outcome = await withRls({ userId: session.user.id, orgId }, async (client) => {
      if (!(await assertMember(client, orgId, session.user.id))) return { status: 403 as const };
      const stored = await loadCadAgentSession(client, orgId, session.user.id);
      const doc = stored?.session;
      if (!doc?.documentId || !doc.workspaceId || !doc.elementId) return { status: 404 as const };
      const availability = await onshapeAvailability(client, orgId, session.user.id);
      if (!availability.connected) return { status: 503 as const };
      const onshape = await loadCadAgentOnshape(client, orgId, session.user.id);
      const response = await onshape.http(
        isoShadedViewPath({ documentId: doc.documentId, workspaceId: doc.workspaceId, elementId: doc.elementId }, { widthPx, heightPx }),
      );
      const body = (await readOnshapeJson(response).catch(() => null)) as { images?: unknown; message?: unknown } | null;
      if (!response.ok) {
        return {
          status: 502 as const,
          message: String(body?.message ?? `Onshape returned HTTP ${response.status} for the shaded view.`),
        };
      }
      // Onshape answers with { images: ["<base64 png>"] } — one image for our single view matrix.
      const first = Array.isArray(body?.images) ? body!.images[0] : null;
      if (typeof first !== "string" || !first) {
        return { status: 502 as const, message: "Onshape returned no image for this Part Studio (is it empty?)." };
      }
      return { status: 200 as const, png: Buffer.from(first, "base64") };
    });

    if (outcome.status === 403) return jsonError(403, { error: "Organization access denied" });
    if (outcome.status === 404) return jsonError(404, { error: "No Part Studio is bound for this workspace.", code: "unbound" });
    if (outcome.status === 503) {
      return jsonError(503, {
        ...onshapeSetupStatus(),
        code: "setup_required",
        status: "setup_required",
        error: "Connect Onshape (or use a shared team connection) to render the viewport.",
      });
    }
    if (outcome.status === 502) return jsonError(502, { error: outcome.message, code: "render_failed" });
    return new Response(new Uint8Array(outcome.png), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "image/png",
        "Content-Length": String(outcome.png.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(502, { error: error instanceof Error ? error.message : "Could not render the viewport", code: "render_failed" });
  }
}
