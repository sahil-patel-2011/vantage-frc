import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  contentRangeHeader,
  parseRangeHeader,
  rangeLength,
  unsatisfiableContentRange,
} from "../../../../../lib/media-library/range";
import {
  storageBackendFor,
  type MediaBytesResult,
} from "../../../../../lib/media-library/storage-backend";
import type { MediaStorageLocation } from "../../../../../lib/media-library/types";
import { dbCapForKind, formatMediaBytes } from "../../../../../lib/media-library/validation";
import { cloudUploadCapBytes } from "../../../../../lib/storage-routing/caps";

type RouteContext = { params: Promise<{ id: string }> };

const BYTE_HEADERS = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cache-control": "private, max-age=3600",
} as const;

/**
 * Upload the raw bytes for a pending in-database item. The metadata row
 * (created via POST /api/media-library action=create-item) already committed
 * the expected size and sha256 — the payload must match both.
 */
export async function PUT(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const content = Buffer.from(await request.arrayBuffer());
  if (!content.byteLength) {
    return Response.json({ error: "Empty upload body" }, { status: 400 });
  }

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const itemResult = await client.query<{
        kind: "photo" | "video";
        byteSize: number;
        sha256: string;
        status: string;
        storageLocation: MediaStorageLocation;
      }>(
        `SELECT kind, byte_size::float8 AS "byteSize", sha256, status,
                storage_location AS "storageLocation"
         FROM media_items
         WHERE id = $1::uuid AND org_id = $2::uuid
         LIMIT 1`,
        [id, orgId],
      );
      const item = itemResult.rows[0];
      if (!item) return { error: "Item not found", status: 404 };
      if (item.storageLocation !== "db") {
        return { error: "This item lives on a storage node — upload through the node.", status: 409 };
      }
      if (item.status === "ready") return { error: "Item already uploaded", status: 409 };

      // Honest cap: min(schema cap for the kind, what the deployed platform
      // can actually accept — 4.5 MB request bodies on Vercel). Bigger media
      // belongs on a paired storage node.
      const cap = Math.min(dbCapForKind(item.kind), cloudUploadCapBytes());
      if (content.byteLength > cap) {
        return {
          error: `Upload is ${formatMediaBytes(content.byteLength)} — over the ${formatMediaBytes(cap)} cloud upload limit. Media this size belongs on a paired storage node (/team/storage).`,
          status: 413,
        };
      }
      if (content.byteLength !== item.byteSize) {
        return {
          error: `Upload is ${content.byteLength} bytes but ${item.byteSize} bytes were declared.`,
          status: 400,
        };
      }
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== item.sha256) {
        return { error: "Upload does not match the declared sha256 checksum.", status: 400 };
      }

      await client.query(
        `UPDATE media_items
         SET bytes = $3, status = 'ready', updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid`,
        [id, orgId, content],
      );
      return { ok: true as const };
    });

    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: message }, { status: 400 });
  }
}

/**
 * Serve item bytes to authenticated org members.
 * - `?thumbnail=1` returns the small in-database thumbnail jpeg.
 * - Full bytes honor single Range requests (206/416) so native <video>
 *   elements can seek.
 * - Node-hosted items 307-redirect to the storage-node proxy route.
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const wantThumbnail = url.searchParams.get("thumbnail") === "1";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const outcome = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const itemResult = await client.query<{
        contentType: string;
        storageLocation: MediaStorageLocation;
        nodeItemId: string | null;
        thumbnail: Buffer | null;
      }>(
        `SELECT content_type AS "contentType", storage_location AS "storageLocation",
                node_item_id AS "nodeItemId",
                CASE WHEN $3 THEN thumbnail ELSE NULL END AS "thumbnail"
         FROM media_items
         WHERE id = $1::uuid AND org_id = $2::uuid
         LIMIT 1`,
        [id, orgId, wantThumbnail],
      );
      const item = itemResult.rows[0];
      if (!item) return { kind: "missing" as const };

      if (wantThumbnail) {
        if (!item.thumbnail) return { kind: "missing" as const };
        return {
          kind: "bytes" as const,
          bytes: Buffer.from(item.thumbnail),
          contentType: "image/jpeg",
        };
      }

      const backend = storageBackendFor(item.storageLocation);
      const fetched: MediaBytesResult = await backend.fetchBytes(client, {
        id,
        orgId,
        contentType: item.contentType,
        storageLocation: item.storageLocation,
        nodeItemId: item.nodeItemId,
      });
      if (fetched.kind === "bytes") {
        return { kind: "bytes" as const, bytes: fetched.bytes, contentType: item.contentType };
      }
      return fetched;
    });

    if (outcome.kind === "missing") {
      return Response.json({ error: "Media not found" }, { status: 404 });
    }
    if (outcome.kind === "redirect") {
      return Response.redirect(new URL(outcome.location, url.origin), 307);
    }
    if (outcome.kind === "unavailable") {
      return Response.json({ error: outcome.reason }, { status: 409 });
    }

    const { bytes, contentType } = outcome;
    const decision = parseRangeHeader(request.headers.get("range"), bytes.byteLength);

    if (decision.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          ...BYTE_HEADERS,
          "accept-ranges": "bytes",
          "content-range": unsatisfiableContentRange(bytes.byteLength),
        },
      });
    }

    if (decision.kind === "range") {
      const { range } = decision;
      const slice = bytes.subarray(range.start, range.end + 1);
      return new Response(new Uint8Array(slice), {
        status: 206,
        headers: {
          ...BYTE_HEADERS,
          "content-type": contentType,
          "accept-ranges": "bytes",
          "content-range": contentRangeHeader(range, bytes.byteLength),
          "content-length": String(rangeLength(range)),
        },
      });
    }

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...BYTE_HEADERS,
        "content-type": contentType,
        "accept-ranges": "bytes",
        "content-length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media unavailable";
    return Response.json({ error: message }, { status: 400 });
  }
}
