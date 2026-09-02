import type { RenderOutcome } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addAsset,
  computeMediaKitView,
  currentSeasonYear,
  deleteAsset,
  deleteDocument,
  generateOnePager,
  upsertProfile,
  type MediaKitView,
} from "../../../lib/media-kit/compute-media-kit";
import type { MediaKitAssetKind } from "../../../lib/media-kit/types";

export type { MediaKitView };

const ASSET_KINDS: MediaKitAssetKind[] = ["logo", "photo", "graphic", "other"];

function oneOf<T extends string>(allowed: T[], value: unknown): T | null {
  return typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : null;
}

function trimmedOrNull(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function seasonFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 2000 && n < 3000 ? Math.round(n) : currentSeasonYear();
}

function yearOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 1900 && n < 3000 ? Math.round(n) : null;
}

function stringArray(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, max);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonParam = url.searchParams.get("season");
  const seasonYear = seasonParam ? seasonFrom(seasonParam) : null;

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMediaKitView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the Media Kit. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
        seasonYear: seasonYear ?? currentSeasonYear(),
      } satisfies MediaKitView,
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
  const seasonYear = seasonFrom(body.seasonYear);

  try {
    const view = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      let render: RenderOutcome | undefined;
      switch (action) {
        case "save-profile": {
          await upsertProfile(client, {
            orgId,
            userId,
            seasonYear,
            missionStatement: trimmedOrNull(body.missionStatement, 2000),
            teamBio: trimmedOrNull(body.teamBio, 4000),
            foundedYear: yearOrNull(body.foundedYear),
            achievements: stringArray(body.achievements),
            contactEmail: trimmedOrNull(body.contactEmail, 200),
            websiteUrl: trimmedOrNull(body.websiteUrl, 300),
          });
          break;
        }
        case "add-asset": {
          const title = trimmedOrNull(body.title, 200);
          const assetUrl = trimmedOrNull(body.url, 1000);
          if (!title) throw new Error("title is required");
          if (!assetUrl) throw new Error("url is required");
          const kind = oneOf<MediaKitAssetKind>(ASSET_KINDS, body.kind) ?? "other";
          await addAsset(client, {
            orgId,
            userId,
            kind,
            title,
            url: assetUrl,
            description: trimmedOrNull(body.description, 1000),
          });
          break;
        }
        case "delete-asset": {
          const assetId = trimmedOrNull(body.assetId, 64);
          if (!assetId) throw new Error("assetId is required");
          await deleteAsset(client, { orgId, assetId });
          break;
        }
        case "generate-one-pager": {
          render = (await generateOnePager(client, { orgId, userId, seasonYear })).render ?? undefined;
          break;
        }
        case "delete-document": {
          const documentId = trimmedOrNull(body.documentId, 64);
          if (!documentId) throw new Error("documentId is required");
          await deleteDocument(client, { orgId, documentId });
          break;
        }
        default:
          throw new Error("Unknown action");
      }

      const view = await computeMediaKitView(client, { userId, requestedOrg: orgId, seasonYear });
      return render ? { ...view, render } : view;
    });

    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media Kit request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
