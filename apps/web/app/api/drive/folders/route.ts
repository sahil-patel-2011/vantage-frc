// Drive folders: create, rename, delete. Every write lands on the caller's
// withRls client, so the 0641 policies decide whether it is allowed —
// personal folders only for their owner, team folders for their creator or a
// lead. Nothing here re-checks that in JavaScript; a refused write comes back
// as "not yours" rather than silently doing nothing.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../lib/drive/api";
import { createFolder, deleteFolderIfEmpty, renameFolder } from "../../../../lib/drive/store";
import { isDriveScope, sanitizeDriveName } from "../../../../lib/drive/validation";

export const dynamic = "force-dynamic";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new DriveHttpError(400, "Invalid JSON body");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireDriveSession();
    const body = await readBody(request);
    const scope = isDriveScope(body.scope) ? body.scope : "team";
    const name = sanitizeDriveName(body.name, 200);
    if (!name) throw new DriveHttpError(400, "A folder needs a name.");
    const parentId = readUuid(body.parentId);
    const requestedOrgId = readUuid(body.orgId);

    const created = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return createFolder(client, { orgId, userId: session.userId, scope, parentId, name });
      },
    );
    return Response.json({ folder: created });
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return Response.json(
        { error: "A folder with that name already exists here." },
        { status: 409 },
      );
    }
    return driveErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireDriveSession();
    const body = await readBody(request);
    const folderId = readUuid(body.folderId);
    if (!folderId) throw new DriveHttpError(400, "folderId is required");
    const name = sanitizeDriveName(body.name, 200);
    if (!name) throw new DriveHttpError(400, "A folder needs a name.");
    const requestedOrgId = readUuid(body.orgId);

    const renamed = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return renameFolder(client, { orgId, folderId, name });
      },
    );
    if (!renamed) {
      throw new DriveHttpError(403, "That folder is not yours to rename.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /duplicate key|unique/i.test(error.message)) {
      return Response.json({ error: "A folder with that name already exists here." }, { status: 409 });
    }
    return driveErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireDriveSession();
    const url = new URL(request.url);
    const folderId = readUuid(url.searchParams.get("folderId"));
    if (!folderId) throw new DriveHttpError(400, "folderId is required");
    const requestedOrgId = readUuid(url.searchParams.get("orgId"));

    const outcome = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return deleteFolderIfEmpty(client, { orgId, folderId });
      },
    );

    if (!outcome.deleted && (outcome.fileCount > 0 || outcome.folderCount > 0)) {
      // Deliberately refuse rather than cascade. A recursive delete that takes
      // fifty files with it is the kind of convenience people only find out
      // about afterwards.
      const parts: string[] = [];
      if (outcome.fileCount > 0) parts.push(`${outcome.fileCount} file${outcome.fileCount === 1 ? "" : "s"}`);
      if (outcome.folderCount > 0) {
        parts.push(`${outcome.folderCount} folder${outcome.folderCount === 1 ? "" : "s"}`);
      }
      return Response.json(
        { error: `This folder still holds ${parts.join(" and ")}. Move or delete them first.` },
        { status: 409 },
      );
    }
    if (!outcome.deleted) throw new DriveHttpError(403, "That folder is not yours to delete.");
    return Response.json({ ok: true });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
