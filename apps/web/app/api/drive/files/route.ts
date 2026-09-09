// Drive files: rename, move, soft-delete and restore. Deletion is a soft
// delete on purpose — a student who drags the wrong thing to the bin at 11pm
// the night before a competition should be able to get it back.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readString,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../lib/drive/api";
import { moveFile, renameFile, restoreFile, softDeleteFile } from "../../../../lib/drive/store";
import { sanitizeDriveName } from "../../../../lib/drive/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
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
    const requestedOrgId = readUuid(body.orgId);
    const action = readString(body.action, 20) ?? "rename";

    const outcome = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);

        if (action === "rename") {
          const name = sanitizeDriveName(body.name, 255);
          if (!name) throw new DriveHttpError(400, "A file needs a name.");
          return (await renameFile(client, { orgId, fileId, name }))
            ? { ok: true as const }
            : { ok: false as const, reason: "That file is not yours to rename." };
        }
        if (action === "move") {
          // `folderId: null` means the root of the space, which is a real
          // destination — distinguish it from "not supplied".
          const folderId = body.folderId === null ? null : readUuid(body.folderId);
          if (body.folderId !== null && !folderId) {
            throw new DriveHttpError(400, "folderId must be a folder id, or null for the top level.");
          }
          const moved = await moveFile(client, { orgId, fileId, folderId });
          return moved.moved
            ? { ok: true as const }
            : { ok: false as const, reason: moved.reason ?? "That file could not be moved." };
        }
        if (action === "restore") {
          return (await restoreFile(client, { orgId, fileId }))
            ? { ok: true as const }
            : { ok: false as const, reason: "That file is not in the bin, or it is not yours." };
        }
        throw new DriveHttpError(400, "action must be rename, move or restore");
      },
    );

    if (!outcome.ok) throw new DriveHttpError(403, outcome.reason);
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireDriveSession();
    const url = new URL(request.url);
    const fileId = readUuid(url.searchParams.get("fileId"));
    if (!fileId) throw new DriveHttpError(400, "fileId is required");
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));

    const deleted = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return softDeleteFile(client, { orgId, fileId });
      },
    );
    if (!deleted) throw new DriveHttpError(403, "That file is not yours to delete.");
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
