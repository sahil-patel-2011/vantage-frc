// A Drive file's thumbnail, when it has one. Only database-hosted images get
// one (generated on upload with sharp); node and object files, video and
// everything else return 404 and the UI shows a type icon rather than a
// placeholder pretending to be a preview.

import { withRls } from "@vantage/db";
import {
  DriveHttpError,
  driveErrorResponse,
  readUuid,
  requireDriveMembership,
  requireDriveSession,
} from "../../../../../../lib/drive/api";
import { loadFileThumb } from "../../../../../../lib/drive/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const session = await requireDriveSession();
    const { fileId: rawFileId } = await context.params;
    const fileId = readUuid(rawFileId);
    if (!fileId) throw new DriveHttpError(400, "Not a file id");
    const requestedOrgId = readUuid(new URL(request.url).searchParams.get("orgId"));

    const thumb = await withRls(
      { userId: session.userId, ...(requestedOrgId ? { orgId: requestedOrgId } : {}) },
      async (client) => {
        const { orgId } = await requireDriveMembership(client, session.userId, requestedOrgId);
        return loadFileThumb(client, { orgId, fileId });
      },
    );
    if (!thumb) throw new DriveHttpError(404, "No thumbnail");

    return new Response(new Uint8Array(thumb), {
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(thumb.byteLength),
        "x-content-type-options": "nosniff",
        // Private: a thumbnail of a personal file must never sit in a shared cache.
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return driveErrorResponse(error);
  }
}
