import { currentSeasonYear } from "@vantage/game-year";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  commitHoursCsv,
  commitIcsDrafts,
  commitNotionJson,
  commitScoutCsv,
  computeMigrateView,
  fetchAndCommitIcsUrl,
  previewCsvHeaders,
  previewIcs,
  previewNotionJson,
  upsertIcsConnection,
  type MigrateView,
} from "../../../lib/migrate/compute-migrate";

const FALLBACK: MigrateView = {
  status: "setup_required",
  message: "Could not load the switching kit. Select a workspace first.",
  steps: [{ id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" }],
  orgId: null,
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMigrateView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  if (action === "preview-ics") {
    const content = typeof body.content === "string" ? body.content : "";
    return Response.json({ drafts: previewIcs(content) });
  }
  if (action === "preview-csv") {
    const content = typeof body.content === "string" ? body.content : "";
    return Response.json(previewCsvHeaders(content));
  }
  if (action === "preview-notion") {
    const content = typeof body.content === "string" ? body.content : "";
    try {
      return Response.json({ drafts: previewNotionJson(content) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Notion JSON";
      return Response.json({ error: message }, { status: 400 });
    }
  }

  try {
    const extra: Record<string, unknown> = {};
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query<{ role: string }>(
        `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, session.user.id],
      );
      const role = member.rows[0]?.role;
      if (role !== "owner" && role !== "admin") throw new Error("forbidden");
      const seasonYear = currentSeasonYear();

      if (action === "connect-ics") {
        const icsUrl = typeof body.icsUrl === "string" ? body.icsUrl : "";
        await upsertIcsConnection(client, {
          orgId,
          userId: session.user.id,
          icsUrl,
          label: typeof body.label === "string" ? body.label : undefined,
        });
      }
      if (action === "sync-ics") {
        const icsUrl = typeof body.icsUrl === "string" ? body.icsUrl : "";
        extra.written = await fetchAndCommitIcsUrl(client, {
          orgId,
          userId: session.user.id,
          icsUrl,
        });
      }
      if (action === "commit-ics") {
        const content = typeof body.content === "string" ? body.content : "";
        extra.written = await commitIcsDrafts(client, {
          orgId,
          userId: session.user.id,
          drafts: previewIcs(content),
        });
      }
      if (action === "commit-hours-csv") {
        extra.written = await commitHoursCsv(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
          seasonYear,
        });
      }
      if (action === "commit-scout-csv") {
        extra.written = await commitScoutCsv(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
        });
      }
      if (action === "commit-notion") {
        extra.counts = await commitNotionJson(client, {
          orgId,
          userId: session.user.id,
          content: typeof body.content === "string" ? body.content : "",
          seasonYear,
        });
      }
      return computeMigrateView(client, { userId: session.user.id, requestedOrg: orgId });
    });
    return Response.json({ ...view, ...extra });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save import";
    if (message === "forbidden") return Response.json({ error: "Forbidden" }, { status: 403 });
    return Response.json({ error: message }, { status: 400 });
  }
}
