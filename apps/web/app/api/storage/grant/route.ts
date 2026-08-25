// Direct-to-node upload authorization. The browser asks for a grant BEFORE
// uploading; the server re-runs the routing decision (never trusting the
// client's claim), creates the metadata rows, and — for node destinations —
// mints a short-lived, single-use, HMAC-signed token scoped to one org + one
// sha256 + a byte ceiling. The node verifies it offline; the bytes go straight
// from the browser to the node and NEVER transit this deployment (whose
// request-body limit is ~4.5 MB on Vercel).
//
// Honesty: the node item row is created as status='missing' (nothing uploaded
// yet); finalize flips it to 'stored' with verified_at NULL so the node's own
// scrub confirms it. If the node already holds the sha (content-addressed),
// the row is reused and the response says alreadyStored — no upload happens.

import { createHash } from "node:crypto";
import { auth } from "@vantage/core";
import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  isSha256Hex,
  isAllowedContentType,
  mediaKindForContentType,
  trimmedOrNull,
} from "../../../../lib/media-library/validation";
import {
  normalizeContentType,
  normalizeGrantUserIds,
  normalizeTags,
  normalizeVisibility,
  sanitizeFileName,
  titleFromFileName,
} from "../../../../lib/library/validation";
import { cloudUploadCapBytes } from "../../../../lib/storage-routing/caps";
import { contentClassFor } from "../../../../lib/storage-routing/classify";
import { decideStorageRoute } from "../../../../lib/storage-routing/decide";
import {
  CHUNKED_UPLOAD_THRESHOLD_BYTES,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_GRANT_TTL_SECONDS,
  mintGrantToken,
} from "../../../../lib/storage-routing/grants";
import {
  createNodeLibraryResource,
  createNodeMediaItem,
  insertUploadGrant,
  loadCandidateNode,
  loadRoutingPolicy,
  upsertNodeItem,
} from "../../../../lib/storage-routing/store";
import type { StorageRouteDecision, StorageUploadTicket } from "../../../../lib/storage-routing/types";

export type StorageGrantResponse =
  | { destination: "cloud"; fallback: boolean; reason: string }
  | { destination: "refused"; reason: string }
  | {
      destination: "node";
      alreadyStored: true;
      reason: string;
      nodeName: string;
      targetId: string;
      duplicate: boolean;
    }
  | {
      destination: "node";
      alreadyStored: false;
      reason: string;
      targetId: string;
      duplicate: boolean;
      ticket: StorageUploadTicket;
    };

const MAX_NODE_FILE_BYTES = 1024 * 1024 * 1024 * 1024; // 1 TiB sanity ceiling

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
  const purpose = body.purpose === "media" ? "media" : body.purpose === "library" ? "library" : null;
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
  const byteSize = typeof body.byteSize === "number" ? Math.round(body.byteSize) : NaN;
  const fileName = sanitizeFileName(body.fileName);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!purpose) return Response.json({ error: "purpose must be 'library' or 'media'" }, { status: 400 });
  if (!isSha256Hex(sha256)) {
    return Response.json({ error: "sha256 must be a 64-character lowercase hex digest" }, { status: 400 });
  }
  if (!Number.isFinite(byteSize) || byteSize < 1 || byteSize > MAX_NODE_FILE_BYTES) {
    return Response.json({ error: "byteSize must be a positive number of bytes" }, { status: 400 });
  }

  // Purpose-specific metadata validation, honest and up front.
  let mediaKind: "photo" | "video" | null = null;
  let contentType: string;
  if (purpose === "media") {
    if (!isAllowedContentType(body.contentType)) {
      return Response.json(
        { error: "Unsupported format. Photos: JPEG, PNG, or WebP. Videos: MP4 or WebM." },
        { status: 400 },
      );
    }
    contentType = body.contentType;
    mediaKind = mediaKindForContentType(contentType);
    if (!mediaKind) return Response.json({ error: "Unsupported media format." }, { status: 400 });
  } else {
    contentType = normalizeContentType(body.contentType);
  }
  const title = trimmedOrNull(body.title, 200) ?? titleFromFileName(fileName);
  if (!title) return Response.json({ error: "A title is required." }, { status: 400 });

  const userId = session.user.id;
  try {
    const result = await withRls({ userId, orgId }, async (client): Promise<StorageGrantResponse> => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2`, [
        orgId,
        userId,
      ]);
      if (!member.rowCount) throw new Error("forbidden");

      const nowMs = Date.now();
      const [{ policy }, node] = await Promise.all([
        loadRoutingPolicy(client, orgId),
        loadCandidateNode(client, orgId, nowMs),
      ]);
      const decision: StorageRouteDecision = decideStorageRoute({
        byteSize,
        contentClass: contentClassFor(fileName, contentType),
        policy,
        node,
        cloudCapBytes: cloudUploadCapBytes(),
      });
      if (decision.destination !== "node") {
        // The client should use the regular cloud upload path (or show the
        // refusal). No rows are created here for those outcomes.
        return decision.destination === "cloud"
          ? { destination: "cloud", fallback: decision.fallback, reason: decision.reason }
          : { destination: "refused", reason: decision.reason };
      }

      // Fetch the node's key material and reachable URL for the ticket.
      const nodeRow = await client.query<{
        id: string;
        name: string;
        baseUrl: string | null;
        encryptedAccessKey: string | null;
      }>(
        `SELECT id, name, base_url AS "baseUrl", encrypted_access_key AS "encryptedAccessKey"
         FROM storage_nodes
         WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL
         LIMIT 1`,
        [decision.nodeId, orgId],
      );
      const chosen = nodeRow.rows[0];
      if (!chosen?.baseUrl) {
        return { destination: "refused", reason: `Storage node "${decision.nodeName}" lost its reachable URL — set it on /team/storage.` };
      }
      if (!chosen.encryptedAccessKey) {
        return {
          destination: "refused",
          reason: `"${chosen.name}" was paired without an access key (an old pairing). Re-pair the node to enable direct uploads.`,
        };
      }

      const { nodeItemId, alreadyStored } = await upsertNodeItem(client, {
        orgId,
        nodeId: chosen.id,
        sha256,
        byteSize,
        contentType,
        userId,
      });

      let targetId: string;
      let duplicate: boolean;
      if (purpose === "library") {
        const visibility = normalizeVisibility(body.visibility);
        const created = await createNodeLibraryResource(client, {
          orgId,
          userId,
          nodeItemId,
          title,
          fileName,
          contentType,
          byteSize,
          sha256,
          folderId: trimmedOrNull(body.folderId, 64),
          notes: trimmedOrNull(body.notes, 4000),
          tags: normalizeTags(body.tags),
          visibility,
          alreadyStored,
        });
        targetId = created.resourceId;
        duplicate = created.duplicate;
        if (!duplicate && visibility === "restricted") {
          const grantUserIds = normalizeGrantUserIds(body.grantUserIds);
          for (const grantee of grantUserIds) {
            await client.query(
              `INSERT INTO library_resource_grants (resource_id, user_id, org_id, granted_by)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
               ON CONFLICT (resource_id, user_id) DO NOTHING`,
              [targetId, grantee, orgId, userId],
            );
          }
        }
      } else {
        const created = await createNodeMediaItem(client, {
          orgId,
          userId,
          nodeItemId,
          kind: mediaKind!,
          title,
          contentType,
          byteSize,
          sha256,
          albumId: trimmedOrNull(body.albumId, 64),
          eventKey: trimmedOrNull(body.eventKey, 40),
          subteam: trimmedOrNull(body.subteam, 60),
          takenAt: typeof body.takenAt === "string" && Number.isFinite(Date.parse(body.takenAt))
            ? new Date(Date.parse(body.takenAt)).toISOString()
            : null,
          width: typeof body.width === "number" && Number.isFinite(body.width) && body.width >= 1 && body.width <= 16384
            ? Math.round(body.width)
            : null,
          height: typeof body.height === "number" && Number.isFinite(body.height) && body.height >= 1 && body.height <= 16384
            ? Math.round(body.height)
            : null,
          durationSeconds:
            typeof body.durationSeconds === "number" &&
            Number.isFinite(body.durationSeconds) &&
            body.durationSeconds > 0 &&
            body.durationSeconds <= 21600
              ? Math.round(body.durationSeconds * 100) / 100
              : null,
          alreadyStored,
        });
        targetId = created.itemId;
        duplicate = created.duplicate;
        // Thumbnails always stay small and in-database, even for node items.
        if (!duplicate && typeof body.thumbnailBase64 === "string" && body.thumbnailBase64) {
          try {
            const thumbnail = Buffer.from(body.thumbnailBase64, "base64");
            if (thumbnail.byteLength >= 1 && thumbnail.byteLength <= 512 * 1024) {
              await client.query(
                `UPDATE media_items SET thumbnail = $3, updated_at = now()
                 WHERE id = $1::uuid AND org_id = $2::uuid`,
                [targetId, orgId, thumbnail],
              );
            }
          } catch {
            /* invalid base64: skip the thumbnail, never the upload */
          }
        }
      }

      if (alreadyStored || duplicate) {
        return {
          destination: "node",
          alreadyStored: true,
          reason: duplicate
            ? "Already in the library (same checksum)."
            : `"${chosen.name}" already holds these exact bytes (same checksum) — nothing to upload.`,
          nodeName: chosen.name,
          targetId,
          duplicate,
        };
      }

      // Mint the offline-verifiable token. Signing key = sha256(accessKey),
      // the value the node has kept in its config since pairing.
      const accessKey = await decryptSecret(JSON.parse(chosen.encryptedAccessKey) as EncryptedSecret, createKms());
      const signingKey = createHash("sha256").update(accessKey).digest("hex");
      const expiresAt = new Date(nowMs + UPLOAD_GRANT_TTL_SECONDS * 1000);
      const { grantId } = await insertUploadGrant(client, {
        orgId,
        nodeId: chosen.id,
        purpose,
        targetId,
        sha256,
        maxBytes: byteSize,
        contentType,
        userId,
        expiresAt,
      });
      const grantToken = mintGrantToken(
        {
          v: 1,
          op: "upload",
          org: orgId,
          sha256,
          maxBytes: byteSize,
          nonce: grantId,
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
        signingKey,
      );

      return {
        destination: "node",
        alreadyStored: false,
        reason: decision.reason,
        targetId,
        duplicate: false,
        ticket: {
          grantId,
          grantToken,
          nodeId: chosen.id,
          nodeName: chosen.name,
          nodeBaseUrl: chosen.baseUrl.replace(/\/+$/, ""),
          sha256,
          maxBytes: byteSize,
          expiresAt: expiresAt.toISOString(),
          chunked: byteSize > CHUNKED_UPLOAD_THRESHOLD_BYTES,
          chunkBytes: UPLOAD_CHUNK_BYTES,
        },
      };
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload authorization failed";
    const status = message === "forbidden" ? 403 : 400;
    return Response.json({ error: message === "forbidden" ? "Organization access denied" : message }, { status });
  }
}
