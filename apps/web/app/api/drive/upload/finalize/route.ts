// The browser reports that a node or object-store transfer landed: consume the
// grant, mark the node item stored, and flip the file to 'ready'.
//
// Honesty: nothing here verifies the bytes itself — the node hash-verifies its
// own uploads, and an object store answers with its own error if the PUT
// failed, in which case the client never calls this and the file stays
// 'pending' and is shown as unfinished rather than as a broken download.
// Idempotent, so a retried finalize after a dropped connection is harmless.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../../lib/drive/api";
import { markFileReady } from "../../../../../lib/drive/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireDriveSession();
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new DriveHttpError(400, "Invalid JSON body");
    }
    const fileId = readUuid(body.fileId);
    if (!fileId) throw new DriveHttpError(400, "fileId is required");
    const grantId = readUuid(body.grantId);
    const requestedOrgId = readUuid(body.orgId);

    const ok = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);

        if (grantId) {
          // Single-use: consuming it is what stops a leaked grant token being
          // replayed. Already-consumed is fine (a retry), not an error.
          const grant = await client.query<{ sha256: string; nodeId: string; consumedAt: string | null }>(
            `SELECT sha256, node_id AS "nodeId", consumed_at AS "consumedAt"
               FROM storage_upload_grants
              WHERE id = $1::uuid AND org_id = $2::uuid AND created_by = $3::uuid
              LIMIT 1`,
            [grantId, orgId, session.userId],
          );
          const row = grant.rows[0];
          if (row && !row.consumedAt) {
            await client.query(
              `UPDATE storage_upload_grants SET consumed_at = now()
                WHERE id = $1::uuid AND org_id = $2::uuid`,
              [grantId, orgId],
            );
            // verified_at stays NULL: the node's own scrub is the source of
            // truth for "the bytes are really there" and confirms within
            // minutes. We record what we know, not what we hope.
            await client.query(
              `UPDATE storage_node_items SET status = 'stored', verified_at = NULL
                WHERE org_id = $1::uuid AND node_id = $2::uuid AND sha256 = $3`,
              [orgId, row.nodeId, row.sha256],
            );
          }
        }

        return markFileReady(client, { orgId, fileId });
      },
    );

    if (!ok) {
      throw new DriveHttpError(
        404,
        "That upload is not yours, was already finished, or stores its bytes in Vantage (use the content upload instead).",
      );
    }
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
