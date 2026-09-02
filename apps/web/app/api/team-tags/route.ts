import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addTeamTag,
  computeTeamTagsView,
  currentTeamTagsSeason,
  deleteTeamTag,
  type TeamTagsView,
} from "../../../lib/team-tags/compute-team-tags";
import { tagsForTeam } from "../../../lib/team-tags/group";
import { promoteToPickList, type PromoteToPickListResult } from "../../../lib/picklist";

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
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTeamTagsView(client, { userId: session.user.id, requestedOrg }),
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
      let promoted: PromoteToPickListResult | null = null;
      if (action === "promote_to_pick_list") {
        // Lift a tagged robot onto THE pick list, carrying its drive-team tags as the note.
        const teamNumber = Number(body.teamNumber);
        if (!Number.isInteger(teamNumber) || teamNumber <= 0) throw new Error("Enter a valid FRC team number.");
        const current = await computeTeamTagsView(client, { userId: session.user.id, requestedOrg: orgId });
        if (current.status !== "live") throw new Error(current.message);
        if (!current.eventKey) throw new Error("Set an active event before promoting to the pick list.");
        const tags = tagsForTeam(current.assignments, teamNumber);
        const notes = current.assignments
          .filter((row) => row.teamNumber === teamNumber && row.notes)
          .map((row) => row.notes!.trim())
          .filter(Boolean);
        const rationale =
          typeof body.rationale === "string" && body.rationale.trim()
            ? body.rationale
            : tags.length
              ? `Tagged ${tags.join(", ")}${notes.length ? ` — ${notes.slice(0, 3).join("; ")}` : ""}`
              : "Promoted from the tag board";
        promoted = await promoteToPickList(client, {
          orgId,
          userId: session.user.id,
          eventKey: current.eventKey,
          teamKey: teamNumber,
          sourceKind: "tags",
          sourceId: null,
          rationale,
          tags: current.assignments
            .filter((row) => row.teamNumber === teamNumber)
            .map((row) => row.tagSlug),
        });
      } else if (action === "tag") {
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
      const next = await computeTeamTagsView(client, { userId: session.user.id, requestedOrg: orgId });
      return { ...next, promoted };
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Team tag write failed";
    if (message === "Organization access denied") return Response.json({ error: message }, { status: 403 });
    if (/required|tag|team number|vocabulary|Unknown team-tags|active event|pick list|reference/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json(FALLBACK);
  }
}
