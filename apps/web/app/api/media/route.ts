import { assertHubTabAccess, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  createMediaContentItem,
  deleteMediaContentItem,
  dismissMediaReminder,
  markMediaContentPosted,
  suggestMediaPostDraft,
  updateMediaContentItem,
} from "../../../lib/media/compute-media-content";
import {
  computeMediaView,
  currentSeasonYear,
  type MediaView,
} from "../../../lib/media/compute-media";
import type {
  MediaContentStatus,
  MediaHubTab,
  MediaPostDraftResult,
} from "../../../lib/media/types";
import {
  MEDIA_CONTENT_KINDS,
  MEDIA_CONTENT_PLATFORMS,
  MEDIA_CONTENT_STATUSES,
  MEDIA_HUB_TABS,
} from "../../../lib/media/types";

export type { MediaView };

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function tabForAction(action: string, bodyTab: unknown): MediaHubTab {
  const explicit = oneOf(MEDIA_HUB_TABS, bodyTab);
  if (explicit) return explicit;
  switch (action) {
    case "ai-draft":
      return "drafts";
    case "dismiss-reminder":
      return "reminders";
    case "create-item":
    case "update-item":
    case "delete-item":
    case "mark-posted":
    default:
      return "calendar";
  }
}

function tabForCreate(status: MediaContentStatus | null, bodyTab: unknown): MediaHubTab {
  const explicit = oneOf(MEDIA_HUB_TABS, bodyTab);
  if (explicit) return explicit;
  return status === "draft" ? "drafts" : "calendar";
}

type MutationResult = MediaView | (MediaView & { draft: MediaPostDraftResult });

async function runMutation(
  userId: string,
  body: Record<string, unknown>,
  actionOverride?: string,
): Promise<MutationResult> {
  const orgId = trimmedOrNull(body.orgId, 64);
  const action = actionOverride ?? (typeof body.action === "string" ? body.action : "");
  if (!orgId) throw new Error("orgId is required");
  if (!action) throw new Error("action is required");

  const seasonYear = seasonFrom(body.seasonYear);

  return withRls({ userId, orgId }, async (client) => {
    const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
      orgId,
      userId,
    ]);
    if (!member.rowCount) throw new Error("forbidden");

    let draft: MediaPostDraftResult | undefined;

    switch (action) {
      case "create-item": {
        const title = trimmedOrNull(body.title, 200);
        if (!title) throw new Error("title is required");
        const status =
          oneOf(MEDIA_CONTENT_STATUSES, body.status) ??
          (body.dueAt ? "scheduled" : "draft");
        await assertHubTabAccess(client, orgId, userId, "media", tabForCreate(status, body.tab));
        await createMediaContentItem(client, {
          orgId,
          userId,
          seasonYear,
          title,
          kind: oneOf(MEDIA_CONTENT_KINDS, body.kind) ?? "post",
          status,
          platform: oneOf(MEDIA_CONTENT_PLATFORMS, body.platform) ?? "other",
          caption: trimmedOrNull(body.caption, 4000),
          dueAt: isoTimestampOrNull(body.dueAt),
          remindAt: isoTimestampOrNull(body.remindAt),
          assignedTo: trimmedOrNull(body.assignedTo, 64),
        });
        break;
      }
      case "update-item": {
        const itemId = trimmedOrNull(body.itemId, 64);
        if (!itemId) throw new Error("itemId is required");
        await assertHubTabAccess(client, orgId, userId, "media", tabForAction(action, body.tab));
        await updateMediaContentItem(client, {
          orgId,
          userId,
          itemId,
          title: body.title !== undefined ? trimmedOrNull(body.title, 200) ?? undefined : undefined,
          kind: oneOf(MEDIA_CONTENT_KINDS, body.kind) ?? undefined,
          status: oneOf(MEDIA_CONTENT_STATUSES, body.status) ?? undefined,
          platform: oneOf(MEDIA_CONTENT_PLATFORMS, body.platform) ?? undefined,
          caption: body.caption !== undefined ? trimmedOrNull(body.caption, 4000) : undefined,
          dueAt: body.dueAt !== undefined ? isoTimestampOrNull(body.dueAt) : undefined,
          remindAt: body.remindAt !== undefined ? isoTimestampOrNull(body.remindAt) : undefined,
          assignedTo: body.assignedTo !== undefined ? trimmedOrNull(body.assignedTo, 64) : undefined,
        });
        break;
      }
      case "delete-item": {
        const itemId = trimmedOrNull(body.itemId, 64);
        if (!itemId) throw new Error("itemId is required");
        await assertHubTabAccess(client, orgId, userId, "media", tabForAction(action, body.tab));
        await deleteMediaContentItem(client, { orgId, itemId });
        break;
      }
      case "ai-draft": {
        await assertHubTabAccess(client, orgId, userId, "media", "drafts");
        draft = await suggestMediaPostDraft(client, {
          orgId,
          userId,
          title: trimmedOrNull(body.title, 200),
          platform: oneOf(MEDIA_CONTENT_PLATFORMS, body.platform),
          notes: trimmedOrNull(body.notes, 4000),
          itemId: trimmedOrNull(body.itemId, 64),
        });
        break;
      }
      case "mark-posted": {
        const itemId = trimmedOrNull(body.itemId, 64);
        if (!itemId) throw new Error("itemId is required");
        await assertHubTabAccess(client, orgId, userId, "media", tabForAction(action, body.tab));
        await markMediaContentPosted(client, { orgId, userId, itemId });
        break;
      }
      case "dismiss-reminder": {
        const itemId = trimmedOrNull(body.itemId, 64);
        if (!itemId) throw new Error("itemId is required");
        await assertHubTabAccess(client, orgId, userId, "media", "reminders");
        await dismissMediaReminder(client, { orgId, userId, itemId });
        break;
      }
      default:
        throw new Error("Unknown action");
    }

    const view = await computeMediaView(client, {
      userId,
      requestedOrg: orgId,
      seasonYear,
    });
    if (draft) return { ...view, draft };
    return view;
  });
}

function mutationErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Media request failed";
  const forbidden =
    message === "forbidden" ||
    message.includes("do not have access") ||
    message.includes("Organization membership required");
  const status = forbidden ? 403 : 400;
  const code =
    typeof error === "object" &&
    error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  return Response.json(
    {
      error: message === "forbidden" ? "Organization access denied" : message,
      ...(code ? { code } : {}),
    },
    { status },
  );
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;
  const tab = oneOf(MEDIA_HUB_TABS, url.searchParams.get("tab"));

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const result = await computeMediaView(client, {
        userId: session.user.id,
        requestedOrg,
        seasonYear,
      });
      if (result.status === "live" && tab) {
        await assertHubTabAccess(client, result.orgId, session.user.id, "media", tab);
      }
      return result;
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("do not have access") || message.includes("Organization membership")) {
      return Response.json({ error: message }, { status: 403 });
    }
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Media team. Choose your team and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Choose your team",
            detail: "Pick which FRC team you are working as.",
            href: "/workspace",
          },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MediaView,
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

  try {
    const view = await runMutation(session.user.id, body);
    return Response.json(view);
  } catch (error) {
    return mutationErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action =
    typeof body.action === "string" && body.action
      ? body.action
      : "update-item";

  try {
    const view = await runMutation(session.user.id, body, action);
    return Response.json(view);
  } catch (error) {
    return mutationErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const view = await runMutation(session.user.id, { ...body, action: "delete-item" }, "delete-item");
    return Response.json(view);
  } catch (error) {
    return mutationErrorResponse(error);
  }
}
