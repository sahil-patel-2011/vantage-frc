import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  MATCH_VIDEO_SOURCES,
  addVideo,
  computeMatchVideoIndexView,
  deleteVideo,
  type MatchVideoIndexView,
} from "../../../lib/match-video-index/compute-match-video-index";
import type { MatchVideoSource } from "../../../lib/match-video-index/types";
import { detectSourceFromUrl } from "../../../lib/match-video-index";

export type { MatchVideoIndexView };

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function tagsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .map((tag) => tag.trim().slice(0, 40))
    .slice(0, 10);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMatchVideoIndexView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load Match Video Index. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies MatchVideoIndexView,
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
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "add-video": {
          const matchKey = trimmedOrNull(body.matchKey, 64);
          const videoUrl = trimmedOrNull(body.videoUrl, 1000);
          if (!matchKey) throw new Error("matchKey is required");
          if (!videoUrl) throw new Error("videoUrl is required");
          const source =
            oneOf<MatchVideoSource>(MATCH_VIDEO_SOURCES, body.source) ?? detectSourceFromUrl(videoUrl);
          await addVideo(client, {
            orgId,
            userId,
            matchKey,
            eventKey: trimmedOrNull(body.eventKey, 40),
            matchLabel: trimmedOrNull(body.matchLabel, 80),
            videoUrl,
            source,
            recordedOn: isoDateOrNull(body.recordedOn),
            notes: trimmedOrNull(body.notes, 2000),
            tags: tagsFrom(body.tags),
          });
          break;
        }
        case "delete-video": {
          const entryId = trimmedOrNull(body.entryId, 64);
          if (!entryId) throw new Error("entryId is required");
          await deleteVideo(client, { orgId, entryId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      return computeMatchVideoIndexView(client, { userId, requestedOrg: orgId });
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Match Video Index request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
