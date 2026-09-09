// One Drive file's bytes.
//
// PUT  — the database ("stored in Vantage") upload path, and ONLY that path.
//        It refuses anything over the deployment's real body limit rather than
//        letting the platform answer with an opaque 413 at the end of the
//        upload, and it verifies the sha256 the grant was issued against, so a
//        file cannot be swapped for different content after routing.
// GET  — streams database bytes, or redirects to the node / object store so
//        the bytes never transit this deployment.
//
// Both are session-authenticated and org-scoped through withRls; the 0641
// policies decide visibility, and a personal file stays invisible to everyone
// but its owner.

import { createHash } from "node:crypto";
import { withRls } from "@vantage/db";
import sharp from "sharp";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../../../lib/drive/api";
import { loadFileContent, storeFileBytes } from "../../../../../../lib/drive/store";
import { drivePreviewKind } from "../../../../../../lib/drive/validation";
import { cloudUploadCapBytes } from "../../../../../../lib/storage-routing/caps";
import {
  objectStoreStatus,
  presignObjectGet,
} from "../../../../../../lib/storage-routing/object-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ fileId: string }> };

/**
 * A small in-database JPEG for images only. Never for video: there is no
 * server-side transcoding here, and a poster frame would mean decoding one.
 * A failure is not an upload failure — the file just has no thumbnail.
 */
async function makeThumb(bytes: Buffer, contentType: string): Promise<Buffer | null> {
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") return null;
  try {
    return await sharp(bytes)
      .rotate()
      .resize(320, 320, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Content-Disposition for a download or an inline preview.
 *
 * Everything we are not willing to render is served as an attachment, and
 * `X-Content-Type-Options: nosniff` is set unconditionally — an uploaded HTML
 * or SVG rendered inline on our own origin would be stored XSS against every
 * member of the team.
 */
function dispositionFor(name: string, download: boolean, contentType: string): string {
  const inline = !download && drivePreviewKind(contentType) !== null;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireDriveSession();
    const { fileId: rawFileId } = await context.params;
    const fileId = readUuid(rawFileId);
    if (!fileId) throw new DriveHttpError(400, "Not a file id");
    const url = new URL(request.url);
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));
    const download = url.searchParams.get("download") === "1";

    const found = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        const file = await loadFileContent(client, { orgId, fileId, includeBytes: true });
        return file ? { orgId, file } : null;
      },
    );
    if (!found) throw new DriveHttpError(404, "That file does not exist, or you cannot see it.");
    const { orgId, file } = found;

    if (file.status !== "ready") {
      throw new DriveHttpError(
        409,
        "This upload never finished, so there are no bytes to fetch. Upload it again.",
      );
    }

    if (file.storageLocation === "db") {
      if (!file.bytes) throw new DriveHttpError(409, "This file's bytes are missing.");
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "content-type": file.contentType,
          "content-length": String(file.bytes.byteLength),
          "content-disposition": dispositionFor(file.name, download, file.contentType),
          "x-content-type-options": "nosniff",
          "cache-control": "private, max-age=0, no-store",
        },
      });
    }

    if (file.storageLocation === "node") {
      if (!file.nodeItemId) throw new DriveHttpError(409, "This file has no storage-node pointer.");
      // The node-item resolver already mints the signed GET grant and answers
      // honestly when the node is unreachable — no reason to write that twice.
      return Response.redirect(
        new URL(
          `/api/storage/node-item/${file.nodeItemId}?orgId=${encodeURIComponent(orgId)}`,
          request.url,
        ),
        302,
      );
    }

    // object
    const store = objectStoreStatus();
    if (!store.configured) {
      throw new DriveHttpError(
        409,
        `This file lives in object storage, which this deployment can no longer reach. ${store.reason}`,
      );
    }
    if (!file.objectKey) throw new DriveHttpError(409, "This file has no object-storage key.");
    const signed = presignObjectGet(store.config, file.objectKey, {
      fileName: file.name,
      download,
    });
    return Response.redirect(signed.url, 302);
  } catch (error) {
    return driveErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await requireDriveSession();
    const { fileId: rawFileId } = await context.params;
    const fileId = readUuid(rawFileId);
    if (!fileId) throw new DriveHttpError(400, "Not a file id");
    const url = new URL(request.url);
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));

    const capBytes = cloudUploadCapBytes();
    const declared = Number(request.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared) && declared > capBytes) {
      throw new DriveHttpError(
        413,
        `This deployment can only accept ${capBytes} bytes through Vantage itself. Bigger files need a storage node or object storage.`,
      );
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength < 1) throw new DriveHttpError(400, "The upload body was empty.");
    if (bytes.byteLength > capBytes) {
      throw new DriveHttpError(
        413,
        `This deployment can only accept ${capBytes} bytes through Vantage itself. Bigger files need a storage node or object storage.`,
      );
    }

    const digest = createHash("sha256").update(bytes).digest("hex");

    const outcome = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        const meta = await client.query<{
          sha256: string;
          byteSize: string;
          contentType: string;
          storageLocation: string;
          status: string;
        }>(
          `SELECT sha256, byte_size::text AS "byteSize", content_type AS "contentType",
                  storage_location AS "storageLocation", status
             FROM drive_files
            WHERE id = $1::uuid AND org_id = $2::uuid AND deleted_at IS NULL
            LIMIT 1`,
          [fileId, orgId],
        );
        const row = meta.rows[0];
        if (!row) return { ok: false as const, status: 404, reason: "That upload does not exist, or is not yours." };
        if (row.storageLocation !== "db") {
          return {
            ok: false as const,
            status: 409,
            reason: "This file's bytes belong on a storage node or in object storage, not here.",
          };
        }
        // The routing decision was made against a declared size and checksum.
        // Verifying both here is what stops a small, allowed file being swapped
        // for different content after the route was granted.
        if (row.sha256 !== digest) {
          return {
            ok: false as const,
            status: 400,
            reason: "The uploaded bytes do not match the checksum this upload was authorized for.",
          };
        }
        if (Number(row.byteSize) !== bytes.byteLength) {
          return {
            ok: false as const,
            status: 400,
            reason: `This upload was authorized for ${row.byteSize} bytes but ${bytes.byteLength} arrived.`,
          };
        }

        const thumb = await makeThumb(bytes, row.contentType);
        const stored = await storeFileBytes(client, { orgId, fileId, bytes, thumb });
        return stored
          ? { ok: true as const }
          : { ok: false as const, status: 403, reason: "That upload is not yours to complete." };
      },
    );

    if (!outcome.ok) throw new DriveHttpError(outcome.status, outcome.reason);
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
