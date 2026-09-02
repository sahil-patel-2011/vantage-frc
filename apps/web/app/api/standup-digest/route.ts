import type { RenderOutcome } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addNote,
  computeStandupDigestView,
  deleteNote,
  generateDigest,
  type StandupDigestView,
} from "../../../lib/standup-digest/compute-standup-digest";
import { defaultDigestDate } from "../../../lib/standup-digest";
import { failMeteredAi } from "../../../lib/metered-ai-fail";

export type { StandupDigestView };

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function digestDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const digestDate = digestDateOrNull(url.searchParams.get("date"));

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeStandupDigestView(client, { userId: session.user.id, requestedOrg, digestDate }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the standup digest. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        digestDate: digestDate ?? defaultDigestDate(),
      } satisfies StandupDigestView,
      { status: 200 },
    );
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

  const orgId = trimmedOrNull(body.orgId, 64);
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const userId = session.user.id;
  const digestDate = digestDateOrNull(body.digestDate) ?? defaultDigestDate();

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      let render: RenderOutcome | undefined;
      switch (action) {
        case "generate": {
          render = (await generateDigest(client, { orgId, userId, digestDate })).render ?? undefined;
          break;
        }
        case "add-note": {
          const subteam = trimmedOrNull(body.subteam, 80);
          const note = trimmedOrNull(body.note, 2000);
          if (!subteam) throw new Error("subteam is required");
          if (!note) throw new Error("note is required");
          await addNote(client, { orgId, userId, digestDate, subteam, note });
          break;
        }
        case "delete-note": {
          const noteId = trimmedOrNull(body.noteId, 64);
          if (!noteId) throw new Error("noteId is required");
          await deleteNote(client, { orgId, noteId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      const view = await computeStandupDigestView(client, { userId, requestedOrg: orgId, digestDate });
      return render ? { ...view, render } : view;
    });

    return Response.json(view);
  } catch (error) {
    return failMeteredAi(error, "Standup digest request failed");
  }
}
