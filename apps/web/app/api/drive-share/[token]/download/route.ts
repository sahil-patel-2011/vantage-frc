/**
 * Public, unauthenticated download of one file covered by a Drive share.
 *
 * Same contract as the sibling resolver: the 32-hex token in the path is the
 * whole authorization, proxy.ts allow-lists it with a narrow regex, and the
 * database call is the SECURITY DEFINER `resolve_drive_share_file` (0641),
 * which will only ever return a file the named share actually covers, and only
 * while that share is live. A caller cannot name some other file id and get it.
 *
 * `?download=1` is the honest download; without it, the handful of types a
 * browser renders safely are served inline. Everything else is an attachment
 * regardless, and `nosniff` is unconditional — an uploaded SVG or HTML page
 * rendered inline on this origin would be stored XSS.
 *
 * See the sibling route for why this is a documented exception to withRls.
 */

import { requestPool } from "@vantage/db";
import {
  anonymizeIp,
  clientIp,
  createRateLimiter,
  rateLimitedResponse,
} from "../../../../../lib/rate-limit";
import { DRIVE_SHARE_TOKEN_PATTERN, drivePreviewKind } from "../../../../../lib/drive/validation";
import {
  objectStoreStatus,
  presignObjectGet,
} from "../../../../../lib/storage-routing/object-store";

export const dynamic = "force-dynamic";

const downloadLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60_000,
  namespace: "drive-share-download",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function notFound(): Response {
  return Response.json(
    { error: "This link is not valid, has expired, or the team has turned it off." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

type ShareFileRow = {
  org_id: string;
  file_id: string;
  name: string;
  content_type: string;
  byte_size: string;
  storage_location: "db" | "node" | "object";
  bytes: Buffer | null;
  node_item_id: string | null;
  object_key: string | null;
  can_download: boolean;
};

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!DRIVE_SHARE_TOKEN_PATTERN.test(token)) return notFound();

  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId") ?? "";
  if (!UUID.test(fileId)) return notFound();
  const download = url.searchParams.get("download") === "1";

  if (!(await downloadLimiter.allow(anonymizeIp(clientIp(request))))) {
    return rateLimitedResponse();
  }

  let file: ShareFileRow | undefined;
  try {
    const result = await requestPool.query<ShareFileRow>(
      "SELECT * FROM resolve_drive_share_file($1, $2::uuid)",
      [token, fileId],
    );
    file = result.rows[0];
  } catch {
    return Response.json(
      { error: "We could not load this right now. Please try again in a minute." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!file) return notFound();

  if (download && !file.can_download) {
    return Response.json(
      { error: "This link is view-only. Ask the person who shared it to allow downloads." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  void requestPool
    .query("SELECT record_drive_share_use($1, $2, $3::uuid)", [
      token,
      download ? "downloaded" : "opened",
      fileId,
    ])
    .catch(() => undefined);

  const inline = !download && drivePreviewKind(file.content_type) !== null;
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const disposition = `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;

  if (file.storage_location === "db") {
    if (!file.bytes) return notFound();
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.content_type,
        "content-length": String(file.bytes.byteLength),
        "content-disposition": disposition,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  }

  if (file.storage_location === "object") {
    const store = objectStoreStatus();
    if (!store.configured || !file.object_key) {
      return Response.json(
        {
          error:
            "This file lives in the team's object storage, which this deployment cannot reach right now.",
        },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.redirect(
      presignObjectGet(store.config, file.object_key, { fileName: file.name, download }).url,
      302,
    );
  }

  // Storage node. The node's own fetch path is org-member gated by design —
  // the node belongs to the team and is not on the public internet for
  // strangers. Rather than redirect a recipient into a 401 they cannot fix,
  // say what is true and who can fix it.
  return Response.json(
    {
      error:
        "This file is stored on the team's own storage node, which is not reachable from a public share link. Ask them to re-share a copy stored in Vantage or in object storage.",
    },
    { status: 409, headers: { "cache-control": "no-store" } },
  );
}
