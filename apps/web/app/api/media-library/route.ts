import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMediaLibraryView,
  createAlbum,
  createItemMetadata,
  deleteAlbum,
  deleteItem,
  setAlbumCover,
  updateItemMetadata,
} from "../../../lib/media-library/compute-media-library";
import type { MediaLibraryView } from "../../../lib/media-library/types";
import {
  THUMBNAIL_CAP_BYTES,
  trimmedOrNull,
  validateUploadMetadata,
} from "../../../lib/media-library/validation";

export type { MediaLibraryView };

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMediaLibraryView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load the media library. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
        ],
        orgId: null,
      } satisfies MediaLibraryView,
      { status: 200 },
    );
  }
}

function decodeThumbnail(value: unknown): Buffer | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !value) return "invalid";
  try {
    const buffer = Buffer.from(value, "base64");
    if (!buffer.byteLength || buffer.byteLength > THUMBNAIL_CAP_BYTES) return "invalid";
    return buffer;
  } catch {
    return "invalid";
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
    const payload = await withRls({ userId, orgId }, async (client) => {
      const member = await client.query(
        `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      if (!member.rowCount) throw new Error("forbidden");

      switch (action) {
        case "create-album": {
          const name = trimmedOrNull(body.name, 120);
          if (!name) throw new Error("Album name is required");
          const albumId = await createAlbum(client, {
            orgId,
            userId,
            name,
            description: trimmedOrNull(body.description, 500),
            eventKey: trimmedOrNull(body.eventKey, 40),
          });
          return { albumId };
        }
        case "create-item": {
          const validated = validateUploadMetadata(body);
          if (!validated.ok) throw new Error(validated.error);
          const created = await createItemMetadata(client, {
            orgId,
            userId,
            metadata: validated.value,
          });
          if (!created.duplicate) {
            const thumbnail = decodeThumbnail(body.thumbnailBase64);
            if (thumbnail === "invalid") throw new Error("Thumbnail must be a small base64 jpeg (max 512 KB).");
            if (thumbnail) {
              await client.query(
                `UPDATE media_items SET thumbnail = $3, updated_at = now()
                 WHERE id = $1::uuid AND org_id = $2::uuid`,
                [created.itemId, orgId, thumbnail],
              );
            }
          }
          return {
            itemId: created.itemId,
            duplicate: created.duplicate,
            uploadUrl: created.duplicate
              ? null
              : `/api/media-library/items/${created.itemId}?orgId=${encodeURIComponent(orgId)}`,
          };
        }
        case "update-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const updated = await updateItemMetadata(client, {
            orgId,
            itemId,
            title: trimmedOrNull(body.title, 200) ?? undefined,
            caption: body.caption === undefined ? undefined : trimmedOrNull(body.caption, 2000),
            albumId: body.albumId === undefined ? undefined : trimmedOrNull(body.albumId, 64),
            eventKey: body.eventKey === undefined ? undefined : trimmedOrNull(body.eventKey, 40),
            subteam: body.subteam === undefined ? undefined : trimmedOrNull(body.subteam, 60),
          });
          if (!updated) throw new Error("Item not found or you cannot edit it");
          return { ok: true };
        }
        case "delete-item": {
          const itemId = trimmedOrNull(body.itemId, 64);
          if (!itemId) throw new Error("itemId is required");
          const deleted = await deleteItem(client, { orgId, itemId });
          if (!deleted) throw new Error("Item not found or you cannot delete it");
          return { ok: true };
        }
        case "delete-album": {
          const albumId = trimmedOrNull(body.albumId, 64);
          if (!albumId) throw new Error("albumId is required");
          const deleted = await deleteAlbum(client, { orgId, albumId });
          if (!deleted) throw new Error("Album not found or you cannot delete it");
          return { ok: true };
        }
        case "set-album-cover": {
          const albumId = trimmedOrNull(body.albumId, 64);
          if (!albumId) throw new Error("albumId is required");
          const updated = await setAlbumCover(client, {
            orgId,
            albumId,
            itemId: trimmedOrNull(body.itemId, 64),
          });
          if (!updated) throw new Error("Album not found or you cannot edit it");
          return { ok: true };
        }
        default:
          throw new Error("Unknown action");
      }
    });

    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media library request failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json(
      { error: message === "forbidden" ? "Organization access denied" : message },
      { status },
    );
  }
}
