import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  approveCaptureDraft,
  computeCaptureView,
  dismissCaptureDraft,
  editCaptureDraft,
  generateCaptureDrafts,
  type CaptureView,
} from "../../../lib/knowledge-capture/compute-capture";
import { MAX_BODY, MAX_TITLE } from "../../../lib/knowledge/types";

export type { CaptureView };

function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeCaptureView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message:
          "Could not load capture drafts. Select a workspace and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Select workspace",
            detail: "Choose your team organization",
            href: "/workspace",
          },
        ],
        orgId: null,
      } satisfies CaptureView,
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

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "generate": {
          await generateCaptureDrafts(client, { orgId, userId });
          break;
        }
        case "edit-draft": {
          const draftId = trimmedOrNull(body.draftId, 64);
          const title = trimmedOrNull(body.title, MAX_TITLE);
          const draftBody = typeof body.body === "string" ? body.body.slice(0, MAX_BODY) : null;
          if (!draftId) throw new Error("draftId is required");
          if (!title) throw new Error("A title is required");
          if (draftBody === null) throw new Error("A body is required");
          await editCaptureDraft(client, { orgId, draftId, title, body: draftBody });
          break;
        }
        case "approve": {
          const draftId = trimmedOrNull(body.draftId, 64);
          if (!draftId) throw new Error("draftId is required");
          // The only path that writes knowledge_pages, and only from a human click.
          await approveCaptureDraft(client, { orgId, userId, draftId });
          break;
        }
        case "dismiss": {
          const draftId = trimmedOrNull(body.draftId, 64);
          const reason = trimmedOrNull(body.reason, 500);
          if (!draftId) throw new Error("draftId is required");
          if (!reason) throw new Error("Say why this draft is being dismissed");
          await dismissCaptureDraft(client, { orgId, userId, draftId, reason });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeCaptureView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Capture draft request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
