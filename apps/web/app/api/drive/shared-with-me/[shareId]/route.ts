// The recipient's side of an email share, for someone who DOES have a Vantage
// account: list the files one share covers, and download one of them, without
// making them dig the emailed link out of their inbox.
//
// Identity comes from the session and only from the session: both database
// calls are SECURITY DEFINER functions (0641) that match on the address of
// `current_app_user_id()` and take no email argument, so this cannot be used
// to read a share addressed to somebody else.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveSession,
} from "../../../../../lib/drive/api";
import { listSharedWithMeFiles, loadSharedWithMeFile } from "../../../../../lib/drive/store";
import { drivePreviewKind } from "../../../../../lib/drive/validation";
import { objectStoreStatus, presignObjectGet } from "../../../../../lib/storage-routing/object-store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ shareId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await requireDriveSession();
    const { shareId: rawShareId } = await context.params;
    const shareId = readUuid(rawShareId);
    if (!shareId) throw new DriveHttpError(400, "Not a share id");

    const url = new URL(request.url);
    const fileId = readUuid(url.searchParams.get("fileId"));
    const download = url.searchParams.get("download") === "1";

    // No fileId: just list what this share covers.
    if (!fileId) {
      const files = await withRls({ userId: session.userId }, (client) =>
        listSharedWithMeFiles(client, shareId),
      );
      return Response.json({ files }, { headers: { "cache-control": "no-store" } });
    }

    const file = await withRls({ userId: session.userId }, (client) =>
      loadSharedWithMeFile(client, { shareId, fileId }),
    );
    if (!file) {
      throw new DriveHttpError(404, "That share is not addressed to you, or it has expired.");
    }
    if (download && !file.canDownload) {
      throw new DriveHttpError(403, "This share is view-only.");
    }

    const inline = !download && drivePreviewKind(file.contentType) !== null;
    const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const disposition = `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;

    if (file.storageLocation === "db") {
      if (!file.bytes) throw new DriveHttpError(409, "This file's bytes are missing.");
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          "content-type": file.contentType,
          "content-length": String(file.bytes.byteLength),
          "content-disposition": disposition,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    }

    if (file.storageLocation === "node") {
      if (!file.nodeItemId) {
        throw new DriveHttpError(
          410,
          "This file lived on a storage node that has since been removed from the team, so its bytes are gone.",
        );
      }
      // The node resolver is org-member gated, which is right: a recipient who
      // is not in the sending team genuinely cannot reach that team's node.
      // Say so rather than redirecting them into a 401.
      return Response.redirect(
        new URL(
          `/api/storage/node-item/${file.nodeItemId}?orgId=${encodeURIComponent(file.orgId)}`,
          request.url,
        ),
        302,
      );
    }

    const store = objectStoreStatus();
    if (!store.configured || !file.objectKey) {
      throw new DriveHttpError(
        409,
        `This file lives in object storage, which this deployment cannot reach right now. ${store.configured ? "" : store.reason}`.trim(),
      );
    }
    return Response.redirect(
      presignObjectGet(store.config, file.objectKey, { fileName: file.name, download }).url,
      302,
    );
  } catch (error) {
    return driveErrorResponse(error);
  }
}
