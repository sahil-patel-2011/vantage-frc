import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { nodeProxyPath } from "../../../../../lib/media-library/storage-backend";
import type { LibraryStorageLocation } from "../../../../../lib/library/types";
import {
  LIBRARY_DB_CAP_BYTES,
  contentDispositionFor,
  formatLibraryBytes,
  isInlinePreviewable,
} from "../../../../../lib/library/validation";
import { cloudUploadCapBytes } from "../../../../../lib/storage-routing/caps";

type RouteContext = { params: Promise<{ id: string }> };

const BYTE_HEADERS = {
  "x-content-type-options": "nosniff",
  // Any file type is storable, so anything active (HTML, SVG) must never
  // execute from our origin.
  "content-security-policy": "default-src 'none'; sandbox",
  "cache-control": "private, max-age=3600",
} as const;

/**
 * Upload the raw bytes for a pending library file. The metadata row (created
 * via POST /api/library action=create-file) already committed the expected
 * size and sha256 — the payload must match both. RLS scopes the UPDATE to the
 * uploader (or an owner/admin).
 */
export async function PUT(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  const content = Buffer.from(await request.arrayBuffer());
  if (!content.byteLength) {
    return Response.json({ error: "Empty files cannot be uploaded." }, { status: 400 });
  }

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const itemResult = await client.query<{
        byteSize: number;
        sha256: string;
        status: string;
        storageLocation: LibraryStorageLocation;
      }>(
        `SELECT byte_size::float8 AS "byteSize", sha256, status,
                storage_location AS "storageLocation"
         FROM library_resources
         WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'file'
         LIMIT 1`,
        [id, orgId],
      );
      const item = itemResult.rows[0];
      if (!item) return { error: "File not found", status: 404 };
      if (item.storageLocation !== "db") {
        return { error: "This file lives on a storage node — upload through the node.", status: 409 };
      }
      if (item.status === "ready") return { error: "File already uploaded", status: 409 };

      // Honest cap: on Vercel the platform rejects request bodies over 4.5 MB
      // before this code even runs, so the enforced cap must match what the
      // deployment can actually accept — bigger files belong on a storage node.
      const cloudCap = Math.min(LIBRARY_DB_CAP_BYTES, cloudUploadCapBytes());
      if (content.byteLength > cloudCap) {
        return {
          error: `Upload is ${formatLibraryBytes(content.byteLength)} — over the ${formatLibraryBytes(cloudCap)} cloud upload limit. Files this size belong on a paired storage node (/team/storage).`,
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

      const updated = await client.query(
        `UPDATE library_resources
         SET bytes = $3, status = 'ready', updated_at = now()
         WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'file'`,
        [id, orgId, content],
      );
      if (!(updated.rowCount ?? 0)) {
        return { error: "You cannot upload into this file.", status: 403 };
      }
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
 * Serve file bytes to members the RLS sharing rules allow. Images may render
 * inline (`?inline=1`); everything else downloads as an attachment.
 * Node-hosted files 307-redirect to the storage-node proxy route (the same
 * plumbing the media library uses, so a paired Pi serves library files too).
 */
export async function GET(request: Request, context: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const wantInline = url.searchParams.get("inline") === "1";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    const outcome = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const itemResult = await client.query<{
        fileName: string;
        contentType: string;
        storageLocation: LibraryStorageLocation;
        nodeItemId: string | null;
        status: string;
        bytes: Buffer | null;
      }>(
        `SELECT file_name AS "fileName", content_type AS "contentType",
                storage_location AS "storageLocation", node_item_id AS "nodeItemId",
                status, bytes
         FROM library_resources
         WHERE id = $1::uuid AND org_id = $2::uuid AND kind = 'file'
         LIMIT 1`,
        [id, orgId],
      );
      const item = itemResult.rows[0];
      if (!item) return { kind: "missing" as const };
      if (item.storageLocation === "node") {
        if (!item.nodeItemId) {
          return { kind: "unavailable" as const, reason: "This file points at a storage node but has no node reference." };
        }
        return { kind: "redirect" as const, location: nodeProxyPath(item.nodeItemId, orgId) };
      }
      if (item.status !== "ready" || !item.bytes) {
        return { kind: "unavailable" as const, reason: "Upload has not finished yet." };
      }
      return {
        kind: "bytes" as const,
        bytes: Buffer.from(item.bytes),
        contentType: item.contentType,
        fileName: item.fileName,
      };
    });

    if (outcome.kind === "missing") {
      return Response.json({ error: "File not found" }, { status: 404 });
    }
    if (outcome.kind === "redirect") {
      return Response.redirect(new URL(outcome.location, url.origin), 307);
    }
    if (outcome.kind === "unavailable") {
      return Response.json({ error: outcome.reason }, { status: 409 });
    }

    const inline = wantInline && isInlinePreviewable(outcome.contentType);
    return new Response(new Uint8Array(outcome.bytes), {
      status: 200,
      headers: {
        ...BYTE_HEADERS,
        "content-type": outcome.contentType,
        "content-length": String(outcome.bytes.byteLength),
        "content-disposition": contentDispositionFor(outcome.fileName, inline),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File unavailable";
    return Response.json({ error: message }, { status: 400 });
  }
}
