/**
 * Honest offline preview for pit photos.
 *
 * The historical last-mile bug: once the IndexedDB blob was deleted after upload, the UI always
 * pointed <img> at /api/scouting/media/:clientId. Offline that 404s as a broken image, which
 * reads as "we have a photo" when we do not. This module never invents a DEMO src.
 */

export type ScoutMediaPreview =
  | {
      status: "local";
      /** Caller creates the object URL from the real queued blob — we do not mint one here. */
      src: null;
      kind: "blob";
      hasThumb: boolean;
    }
  | {
      status: "remote";
      src: string;
      variant: "thumb" | "full";
    }
  | {
      status: "missing";
      src: null;
      reason: string;
    };

export function scoutMediaFileUrl(
  orgId: string,
  clientId: string,
  variant: "thumb" | "full" = "full",
): string {
  const params = new URLSearchParams({ orgId });
  if (variant === "thumb") params.set("variant", "thumb");
  return `/api/scouting/media/${encodeURIComponent(clientId)}?${params.toString()}`;
}

/**
 * Decide what a pit-photo chip may render. Priority:
 * 1. A local queued/quarantined blob — the actual capture, works offline.
 * 2. A remote thumb, only when the server has one (never `?variant=thumb` on a 6MB original).
 * 3. The remote full file, only when we know the upload succeeded and we are online.
 * 4. missing — say so. Never a placeholder jpeg, never a URL that will 404 offline.
 */
export function resolveScoutMediaPreview(input: {
  orgId: string;
  clientId: string;
  hasLocalBlob: boolean;
  hasLocalThumb?: boolean;
  uploaded?: boolean;
  online?: boolean;
  hasRemoteThumb?: boolean;
}): ScoutMediaPreview {
  const clientId = input.clientId.trim();
  const orgId = input.orgId.trim();
  if (!clientId || !orgId) {
    return { status: "missing", src: null, reason: "No photo is available." };
  }

  if (input.hasLocalBlob) {
    return {
      status: "local",
      src: null,
      kind: "blob",
      hasThumb: Boolean(input.hasLocalThumb),
    };
  }

  if (input.online === false) {
    return {
      status: "missing",
      src: null,
      reason: "This photo is still on the device that captured it.",
    };
  }

  if (input.uploaded !== true) {
    return {
      status: "missing",
      src: null,
      reason: "This photo has not uploaded yet.",
    };
  }

  if (input.hasRemoteThumb === true) {
    return {
      status: "remote",
      src: scoutMediaFileUrl(orgId, clientId, "thumb"),
      variant: "thumb",
    };
  }

  return {
    status: "remote",
    src: scoutMediaFileUrl(orgId, clientId, "full"),
    variant: "full",
  };
}

/** True when the preview may drive an <img>. missing never should. */
export function scoutMediaPreviewHasImage(preview: ScoutMediaPreview): boolean {
  return preview.status === "local" || preview.status === "remote";
}

export type ScoutMediaGetVariant = "thumb" | "full";

export const SCOUT_MEDIA_FILE_MISSING = "Media not found";
export const SCOUT_MEDIA_THUMB_MISSING = "Thumbnail not found";

/** Only the literal `thumb` query value asks for the small file. Anything else is the original. */
export function parseScoutMediaGetVariant(raw: string | null | undefined): ScoutMediaGetVariant {
  return raw === "thumb" ? "thumb" : "full";
}

export function isScoutMediaThumbColumnMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /thumb_bytes|42703|undefined_column|column .* does not exist/i.test(message);
}

function hasScoutMediaPayload(bytes: Uint8Array | null | undefined): bytes is Uint8Array {
  return Boolean(bytes && bytes.byteLength > 0);
}

export type ScoutMediaGetRow = {
  contentType?: string | null;
  bytes?: Uint8Array | null;
  thumbBytes?: Uint8Array | null;
};

export type ScoutMediaGetPayload =
  | { status: "ok"; body: Uint8Array; contentType: string; variant: ScoutMediaGetVariant }
  | { status: "missing"; reason: string };

/**
 * Pick the bytes a GET may serve. `variant=thumb` never falls back to `bytes` and never
 * mints a DEMO jpeg — missing thumb is missing.
 */
export function pickScoutMediaGetPayload(
  row: ScoutMediaGetRow | null,
  variant: ScoutMediaGetVariant,
): ScoutMediaGetPayload {
  if (variant === "thumb") {
    const thumbBytes = row?.thumbBytes;
    if (!hasScoutMediaPayload(thumbBytes)) {
      return { status: "missing", reason: SCOUT_MEDIA_THUMB_MISSING };
    }
    return {
      status: "ok",
      body: new Uint8Array(thumbBytes),
      contentType: row?.contentType?.trim() || "image/jpeg",
      variant: "thumb",
    };
  }

  const bytes = row?.bytes;
  if (!hasScoutMediaPayload(bytes)) {
    return { status: "missing", reason: SCOUT_MEDIA_FILE_MISSING };
  }
  return {
    status: "ok",
    body: new Uint8Array(bytes),
    contentType: row?.contentType?.trim() || "application/octet-stream",
    variant: "full",
  };
}
