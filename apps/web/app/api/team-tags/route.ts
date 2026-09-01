import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addTeamTag,
  computeTeamTagsView,
  currentTeamTagsSeason,
  deleteTeamTag,
  teamTagsPickReasonsPayload,
  type TeamTagsView,
} from "../../../lib/team-tags/compute-team-tags";

const FALLBACK: TeamTagsView = {
  status: "setup_required",
  message: "Could not load drive-team tags. Select a workspace and confirm database access.",
  steps: [{ id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" }],
  orgId: null,
  seasonYear: currentTeamTagsSeason(),
};

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTeamTagsView(client, { userId: session.user.id, requestedOrg }),
    );
    if (url.searchParams.get("as") === "pick-reasons") {
      return Response.json(teamTagsPickReasonsPayload(view, url.searchParams.get("teamNumber")));
    }
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
  const orgId = uuidOrNull(body.orgId);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      if (action === "tag") {
        const tagId = uuidOrNull(body.tagId);
        if (!tagId) throw new Error("Choose a tag from the vocabulary.");
        await addTeamTag(client, {
          orgId,
          userId: session.user.id,
          tagId,
          teamNumber: body.teamNumber,
          notes: body.notes,
        });
      } else if (action === "delete") {
        const assignmentId = uuidOrNull(body.assignmentId);
        if (!assignmentId) throw new Error("assignmentId is required");
        await deleteTeamTag(client, { orgId, assignmentId });
      } else {
        throw new Error("Unknown team-tags action");
      }
      return computeTeamTagsView(client, { userId: session.user.id, requestedOrg: orgId });
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team tag write failed";
    if (message === "Organization access denied") return Response.json({ error: message }, { status: 403 });
    if (/required|tag|team number|vocabulary|Unknown team-tags/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json(FALLBACK);
  }
}
