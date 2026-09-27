import { MEDIA_ENABLED, MEDIA_PAUSED_MESSAGE } from "../../lib/media-availability";
import { queueMedia, quarantineMedia, stableClientId } from "../../lib/scout-offline";
import { exceedsMediaCap, mediaKindLabel, oversizeMediaReason } from "../../lib/scouting/media-downscale";
import { buildAttachMediaWire } from "../../lib/scouting/attach-media-wire";
import { prepareScoutMediaFile, scoutMediaKind } from "../../lib/scouting/prepare-scout-media";
import { asMediaFile, downscaleImageInBrowser } from "./scouting-media-browser";

export async function attachScoutingMedia(
  file: File,
  options: { fieldKey?: string; tags?: string[] } | undefined,
  context: {
    orgId: string;
    eventKey: string | null | undefined;
    teamKey: string;
    entryClientId: string;
    setMessage: (message: string) => void;
    refreshCounts: () => Promise<void>;
    sync: () => Promise<void>;
  },
) {
  const { orgId, eventKey, teamKey, entryClientId, setMessage, refreshCounts, sync } = context;
  if (!MEDIA_ENABLED) { setMessage(MEDIA_PAUSED_MESSAGE); return null; }
  const tags = ["pit", ...(options?.tags ?? [])];
  const kind = scoutMediaKind(file);
  const gate = buildAttachMediaWire({
    eventKey,
    teamKey,
    entryClientId,
    entryId: null,
    kind,
    contentType: file.type || "image/jpeg",
    byteSize: file.size,
    tags,
    fieldKey: options?.fieldKey,
  });
  if (!gate.ok) {
    setMessage(gate.reason);
    return null;
  }

  const clientId = stableClientId();
  // Phone photos are routinely >6MB — downscale before anything is queued.
  const downscaled = await downscaleImageInBrowser(file);
  const candidate = asMediaFile(downscaled, file);

  // Final gate before IndexedDB: empty, unsupported, and still-over-cap files are PERMANENT
  // failures. They go to quarantine (which owns retry/discard) instead of the upload outbox,
  // where they would retry against a guaranteed 400 forever. Unlinked captures never persist.
  let prepared: File;
  try {
    prepared = await prepareScoutMediaFile(candidate);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : oversizeMediaReason(candidate.size, mediaKindLabel(kind));
    const failed = buildAttachMediaWire({
      eventKey,
      teamKey,
      entryClientId,
      entryId: null,
      kind,
      contentType: candidate.type || file.type || "image/jpeg",
      byteSize: candidate.size,
      tags,
      fieldKey: options?.fieldKey,
    });
    if (failed.ok) {
      await quarantineMedia(
        { clientId, orgId, metadata: failed.metadata, blob: candidate },
        reason,
      );
    }
    setMessage(reason);
    await refreshCounts();
    return null;
  }

  const blob: Blob = prepared;
  const queued = buildAttachMediaWire({
    eventKey,
    teamKey,
    entryClientId,
    entryId: null,
    kind,
    contentType: blob.type || file.type || "image/jpeg",
    byteSize: blob.size,
    tags,
    fieldKey: options?.fieldKey,
  });
  if (!queued.ok) {
    setMessage(queued.reason);
    return null;
  }
  if (exceedsMediaCap(blob.size)) {
    // Belt-and-braces: prepare should have refused this, so quarantine rather than queue.
    const reason = oversizeMediaReason(blob.size, mediaKindLabel(kind));
    await quarantineMedia({ clientId, orgId, metadata: queued.metadata, blob }, reason);
    setMessage(reason);
    await refreshCounts();
    return null;
  }
  await queueMedia({ clientId, orgId, metadata: queued.metadata, blob });
  setMessage(
    options?.fieldKey
      ? "Robot photo queued to upload"
      : "Photo queued to upload",
  );
  await refreshCounts();
  await sync();
  return clientId;
}

