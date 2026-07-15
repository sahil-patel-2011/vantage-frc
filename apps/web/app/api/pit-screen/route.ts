import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseYouTubeEmbed } from "../../../lib/youtube";

async function sessionOrg(orgId: string | null) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  if (!orgId) throw new Error("orgId is required");
  return { session, orgId };
}

export async function GET(request: Request) {
  try {
    const requestedOrgId = new URL(request.url).searchParams.get("orgId");
    const { session, orgId } = await sessionOrg(requestedOrgId);
    const row = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const board = await client.query<{ widgets: Array<{ type?: string; config?: { url?: string; title?: string } }> }>(
        `SELECT widgets FROM display_boards WHERE org_id=$1 AND name='Vantage Pit Stream' LIMIT 1`,
        [orgId],
      );
      return board.rows[0] ?? null;
    });
    const stream = row?.widgets?.find((widget) => widget.type === "pit_stream");
    const url = stream?.config?.url ?? "";
    const parsed = url ? parseYouTubeEmbed(url) : null;
    return Response.json({
      url: parsed ? url : "",
      embedUrl: parsed?.embedUrl ?? null,
      title: stream?.config?.title ?? "Pit Screen",
      source: parsed ? "org" : "empty",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { orgId?: string; url?: string; title?: string };
    const { session, orgId } = await sessionOrg(body.orgId ?? null);
    const raw = String(body.url ?? "").trim();
    const parsed = raw ? parseYouTubeEmbed(raw) : null;
    if (raw && !parsed) throw new Error("Only HTTPS YouTube watch/embed/share URLs are allowed");

    await withRls({ userId: session.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin','scout')`,
        [orgId, session.user.id],
      );
      if (!admin.rowCount) throw new Error("Team membership required");
      const widgets = parsed
        ? [{ type: "pit_stream", x: 0, y: 0, w: 12, h: 8, config: { url: raw, title: String(body.title ?? "Pit Screen").slice(0, 120) } }]
        : [];
      await client.query(
        `INSERT INTO display_boards(id,org_id,name,preset,widgets,created_by)
         VALUES(gen_random_uuid(),$1,'Vantage Pit Stream','custom',$2::jsonb,$3)
         ON CONFLICT (org_id, name) DO UPDATE SET widgets=excluded.widgets,updated_at=now()`,
        [orgId, JSON.stringify(widgets), session.user.id],
      );
    });

    return Response.json({
      ok: true,
      url: parsed ? raw : "",
      embedUrl: parsed?.embedUrl ?? null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}
