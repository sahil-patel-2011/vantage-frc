// One file's upload authorization for Vantage Drive.
//
// The browser asks for a grant BEFORE uploading. The server re-runs the
// routing decision — it never trusts the client's claim about where the file
// should go — creates the metadata row as `pending`, and hands back exactly
// one of:
//
//   cloud   the bytes come back through PUT /api/drive/files/<id>/content
//           (only ever within the platform's real body limit)
//   node    a short-lived signed grant for the team's storage node; the bytes
//           go browser -> node and never transit this deployment
//   object  a presigned S3 PUT; likewise, browser -> bucket, never through us
//   refused with the real numbers and the real reason
//
// Nothing is marked ready until the bytes actually land (finalize, or the
// content PUT), so a file that never finished uploading shows as pending
// rather than as a download that 404s.

import { createHash } from "node:crypto";
import { createKms, decryptSecret, type EncryptedSecret } from "@vantage/billing";
import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../../lib/drive/api";
import { createFileRow } from "../../../../../lib/drive/store";
import {
  isDriveScope,
  normalizeDriveContentType,
  sanitizeDriveName,
} from "../../../../../lib/drive/validation";
import { cloudUploadCapBytes } from "../../../../../lib/storage-routing/caps";
import { contentClassFor } from "../../../../../lib/storage-routing/classify";
import { decideStorageRoute } from "../../../../../lib/storage-routing/decide";
import {
  CHUNKED_UPLOAD_THRESHOLD_BYTES,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_GRANT_TTL_SECONDS,
  mintGrantToken,
} from "../../../../../lib/storage-routing/grants";
import {
  driveObjectKey,
  objectStoreStatus,
  presignObjectPut,
} from "../../../../../lib/storage-routing/object-store";
import {
  insertUploadGrant,
  loadCandidateNode,
  loadRoutingPolicy,
  upsertNodeItem,
} from "../../../../../lib/storage-routing/store";

export const dynamic = "force-dynamic";

/** Sanity ceiling for one file, matching the node path's existing limit. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const session = await requireDriveSession();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new DriveHttpError(400, "Invalid JSON body");
    }

    const requestedOrgId = readUuid(body.orgId);
    const scope = isDriveScope(body.scope) ? body.scope : "team";
    const folderId = readUuid(body.folderId);
    const name = sanitizeDriveName(body.name, 255);
    if (!name) throw new DriveHttpError(400, "A file needs a name.");
    const contentType = normalizeDriveContentType(body.contentType);
    const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new DriveHttpError(400, "sha256 must be a 64-character lowercase hex digest");
    }
    const byteSize = Number(body.byteSize);
    if (!Number.isFinite(byteSize) || byteSize < 1 || byteSize > MAX_FILE_BYTES) {
      throw new DriveHttpError(400, "byteSize must be a positive number of bytes");
    }

    const objectStore = objectStoreStatus();
    const result = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        const nowMs = Date.now();
        const [{ policy }, node] = await Promise.all([
          loadRoutingPolicy(client, orgId),
          loadCandidateNode(client, orgId, nowMs),
        ]);
        const contentClass = contentClassFor(name, contentType);
        const decision = decideStorageRoute({
          byteSize: Math.round(byteSize),
          contentClass,
          policy,
          node,
          cloudCapBytes: cloudUploadCapBytes(),
          objectStore: objectStore.configured
            ? { configured: true }
            : { configured: false, reason: objectStore.reason },
        });

        if (decision.destination === "refused") {
          return { destination: "refused" as const, reason: decision.reason };
        }

        if (decision.destination === "cloud") {
          const file = await createFileRow(client, {
            orgId,
            userId: session.userId,
            scope,
            folderId,
            name,
            contentType,
            contentClass,
            byteSize: Math.round(byteSize),
            sha256,
            storageLocation: "db",
            nodeItemId: null,
            objectKey: null,
          });
          return {
            destination: "cloud" as const,
            fileId: file.id,
            reason: decision.reason,
            capBytes: cloudUploadCapBytes(),
          };
        }

        if (decision.destination === "object") {
          if (!objectStore.configured) {
            // Unreachable — decideStorageRoute only returns 'object' when the
            // store is configured — but a refusal beats a crash if that ever
            // stops being true.
            return { destination: "refused" as const, reason: objectStore.reason };
          }
          const key = driveObjectKey(orgId, sha256);
          const file = await createFileRow(client, {
            orgId,
            userId: session.userId,
            scope,
            folderId,
            name,
            contentType,
            contentClass,
            byteSize: Math.round(byteSize),
            sha256,
            storageLocation: "object",
            nodeItemId: null,
            objectKey: key,
          });
          const put = presignObjectPut(objectStore.config, key);
          return {
            destination: "object" as const,
            fileId: file.id,
            reason: decision.reason,
            put,
          };
        }

        // --- node ---
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
          return {
            destination: "refused" as const,
            reason: `Storage node "${decision.nodeName}" lost its reachable URL — set it on /team/storage.`,
          };
        }
        if (!chosen.encryptedAccessKey) {
          return {
            destination: "refused" as const,
            reason: `"${chosen.name}" was paired without an access key (an old pairing). Re-pair the node to enable direct uploads.`,
          };
        }

        const { nodeItemId, alreadyStored } = await upsertNodeItem(client, {
          orgId,
          nodeId: chosen.id,
          sha256,
          byteSize: Math.round(byteSize),
          contentType,
          userId: session.userId,
        });

        const file = await createFileRow(client, {
          orgId,
          userId: session.userId,
          scope,
          folderId,
          name,
          contentType,
          contentClass,
          byteSize: Math.round(byteSize),
          sha256,
          storageLocation: "node",
          nodeItemId,
          objectKey: null,
        });

        if (alreadyStored) {
          // The node is content-addressed and already holds these exact bytes.
          await client.query(
            `UPDATE drive_files SET status = 'ready', updated_at = now()
              WHERE id = $1::uuid AND org_id = $2::uuid`,
            [file.id, orgId],
          );
          return {
            destination: "node" as const,
            fileId: file.id,
            alreadyStored: true as const,
            reason: `"${chosen.name}" already holds these exact bytes (same checksum) — nothing to upload.`,
          };
        }

        const accessKey = await decryptSecret(
          JSON.parse(chosen.encryptedAccessKey) as EncryptedSecret,
          createKms(),
        );
        const signingKey = createHash("sha256").update(accessKey).digest("hex");
        const expiresAt = new Date(nowMs + UPLOAD_GRANT_TTL_SECONDS * 1000);
        const { grantId } = await insertUploadGrant(client, {
          orgId,
          nodeId: chosen.id,
          // 'drive' was added to the ledger by migration 0641 so the audit
          // trail names the real feature. Drive finalizes through its own
          // route (/api/drive/upload/finalize), which flips the drive_files
          // row and the node item directly.
          purpose: "drive",
          targetId: file.id,
          sha256,
          maxBytes: Math.round(byteSize),
          contentType,
          userId: session.userId,
          expiresAt,
        });
        const grantToken = mintGrantToken(
          {
            v: 1,
            op: "upload",
            org: orgId,
            sha256,
            maxBytes: Math.round(byteSize),
            nonce: grantId,
            exp: Math.floor(expiresAt.getTime() / 1000),
          },
          signingKey,
        );

        return {
          destination: "node" as const,
          fileId: file.id,
          alreadyStored: false as const,
          reason: decision.reason,
          ticket: {
            grantId,
            grantToken,
            nodeId: chosen.id,
            nodeName: chosen.name,
            nodeBaseUrl: chosen.baseUrl.replace(/\/+$/, ""),
            sha256,
            maxBytes: Math.round(byteSize),
            expiresAt: expiresAt.toISOString(),
            chunked: byteSize > CHUNKED_UPLOAD_THRESHOLD_BYTES,
            chunkBytes: UPLOAD_CHUNK_BYTES,
          },
        };
      },
    );

    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
