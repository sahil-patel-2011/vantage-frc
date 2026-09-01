import { describe, expect, it } from "vitest";
import {
  MAX_SCOUT_MEDIA_BYTES,
  SCOUT_MEDIA_THUMB_EDGE,
  buildScoutMediaMetadata,
  isPermanentScoutMediaError,
  prepareScoutMediaFile,
  prepareScoutMediaThumb,
  prepareScoutPitPhoto,
  requireScoutMediaEntryLink,
  scoutMediaKind,
  scoutMediaOversizeMessage,
  scoutMediaThumbDimensions,
  scoutMediaUnlinkedMessage,
  scoutMediaUnsupportedMessage,
} from "./prepare-scout-media";

async function rejection(file: File): Promise<unknown> {
  try {
    await prepareScoutMediaFile(file);
  } catch (error) {
    return error;
  }
  throw new Error("expected prepareScoutMediaFile to reject");
}

describe("prepareScoutMediaFile", () => {
  it("refuses empty files", async () => {
    const file = new File([], "empty.jpg", { type: "image/jpeg" });
    await expect(prepareScoutMediaFile(file)).rejects.toThrow(/empty/i);
  });

  it("passes through jpegs already under the upload cap", async () => {
    const file = new File([new Uint8Array(128)], "ok.jpg", { type: "image/jpeg" });
    await expect(prepareScoutMediaFile(file)).resolves.toBe(file);
  });

  it("passes through an in-cap video and audio clip untouched (no transcode)", async () => {
    const video = new File([new Uint8Array(64)], "clip.mp4", { type: "video/mp4" });
    const audio = new File([new Uint8Array(64)], "note.webm", { type: "audio/webm" });
    await expect(prepareScoutMediaFile(video)).resolves.toBe(video);
    await expect(prepareScoutMediaFile(audio)).resolves.toBe(audio);
  });

  it("refuses oversized videos instead of leaving them stuck in the outbox", async () => {
    const file = new File([new Uint8Array(MAX_SCOUT_MEDIA_BYTES + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    await expect(prepareScoutMediaFile(file)).rejects.toThrow(scoutMediaOversizeMessage());
  });

  it("refuses oversized images when the browser cannot decode them", async () => {
    const file = new File([new Uint8Array(MAX_SCOUT_MEDIA_BYTES + 1)], "huge.jpg", {
      type: "image/jpeg",
    });
    await expect(prepareScoutMediaFile(file)).rejects.toThrow(scoutMediaOversizeMessage());
  });

  it("refuses unsupported file types outright", async () => {
    const file = new File([new Uint8Array(64)], "spec.pdf", { type: "application/pdf" });
    await expect(prepareScoutMediaFile(file)).rejects.toThrow(
      scoutMediaUnsupportedMessage({ type: "application/pdf", name: "spec.pdf" }),
    );
  });

  it("marks every refusal PERMANENT so the caller quarantines instead of retrying", async () => {
    const cases = [
      new File([], "empty.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array(MAX_SCOUT_MEDIA_BYTES + 1)], "clip.mp4", { type: "video/mp4" }),
      new File([new Uint8Array(MAX_SCOUT_MEDIA_BYTES + 1)], "long.webm", { type: "audio/webm" }),
      new File([new Uint8Array(MAX_SCOUT_MEDIA_BYTES + 1)], "huge.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array(64)], "spec.pdf", { type: "application/pdf" }),
    ];
    for (const file of cases) {
      expect(isPermanentScoutMediaError(await rejection(file))).toBe(true);
    }
  });

  it("names the real cap in the oversize message", () => {
    expect(scoutMediaOversizeMessage()).toContain("6.0 MB");
  });
});

describe("scoutMediaKind", () => {
  it("maps a captured file onto the scout_media kinds", () => {
    expect(scoutMediaKind({ type: "image/heic", name: "IMG_1.HEIC" })).toBe("photo");
    expect(scoutMediaKind({ type: "video/quicktime", name: "IMG_2.MOV" })).toBe("video");
    expect(scoutMediaKind({ type: "audio/webm", name: "note.webm" })).toBe("audio");
    // A typeless pick (some Android pickers) is treated as a photo, matching prepare's guess.
    expect(scoutMediaKind({ type: "", name: "blob" })).toBe("photo");
  });
});

describe("scout media entry link", () => {
  it("requires a non-empty entryClientId so photos cannot be queued as orphans", () => {
    expect(() => requireScoutMediaEntryLink({})).toThrow(scoutMediaUnlinkedMessage());
    expect(() => requireScoutMediaEntryLink({ entryClientId: "   " })).toThrow(
      scoutMediaUnlinkedMessage(),
    );
    expect(isPermanentScoutMediaError((() => {
      try {
        requireScoutMediaEntryLink({ entryId: "entry-1" });
      } catch (error) {
        return error;
      }
    })())).toBe(true);
  });

  it("keeps a known server entryId and treats a blank one as null", () => {
    expect(requireScoutMediaEntryLink({ entryClientId: "entry-local-1", entryId: "  " })).toEqual({
      entryClientId: "entry-local-1",
      entryId: null,
    });
    expect(
      requireScoutMediaEntryLink({ entryClientId: " entry-local-1 ", entryId: " uuid-1 " }),
    ).toEqual({ entryClientId: "entry-local-1", entryId: "uuid-1" });
  });

  it("builds upload metadata that always carries the entry link", () => {
    const metadata = buildScoutMediaMetadata({
      eventKey: "2026mndu",
      teamKey: "frc254",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 128,
      tags: ["pit"],
      fieldKey: "robot_images",
      entryClientId: "entry-local-1",
      entryId: "uuid-1",
      hasThumb: true,
      thumbContentType: "image/jpeg",
      thumbByteSize: 40,
    });
    expect(metadata.entryClientId).toBe("entry-local-1");
    expect(metadata.entryId).toBe("uuid-1");
    expect(metadata.hasThumb).toBe(true);
    expect(metadata.tags).toEqual(["pit", "field:robot_images", "robot_image"]);
  });

  it("refuses to build metadata without an entryClientId", () => {
    expect(() =>
      buildScoutMediaMetadata({
        eventKey: "2026mndu",
        teamKey: "frc254",
        kind: "photo",
        contentType: "image/jpeg",
        byteSize: 128,
        entryClientId: "",
      }),
    ).toThrow(scoutMediaUnlinkedMessage());
  });
});

describe("scout media thumbs", () => {
  it("shrinks a phone photo so the long edge is the thumb cap", () => {
    const result = scoutMediaThumbDimensions(4032, 3024);
    expect(result.scaled).toBe(true);
    expect(result.width).toBe(SCOUT_MEDIA_THUMB_EDGE);
    expect(result.height).toBe(240);
  });

  it("never upscales a small pit photo into a fake high-res thumb", () => {
    expect(scoutMediaThumbDimensions(160, 120)).toEqual({
      width: 160,
      height: 120,
      scaled: false,
    });
  });

  it("returns null for a thumb when the environment cannot decode — never a DEMO jpeg", async () => {
    const file = new File([new Uint8Array(128)], "ok.jpg", { type: "image/jpeg" });
    await expect(prepareScoutMediaThumb(file)).resolves.toBeNull();
  });

  it("does not invent a poster frame for video or audio", async () => {
    const video = new File([new Uint8Array(64)], "clip.mp4", { type: "video/mp4" });
    await expect(prepareScoutMediaThumb(video)).resolves.toBeNull();
  });

  it("refuses to prepare a pit photo that is not linked to an entry", async () => {
    const file = new File([new Uint8Array(128)], "ok.jpg", { type: "image/jpeg" });
    await expect(prepareScoutPitPhoto(file, {})).rejects.toThrow(scoutMediaUnlinkedMessage());
  });

  it("returns the real file plus an honest null thumb in node", async () => {
    const file = new File([new Uint8Array(128)], "ok.jpg", { type: "image/jpeg" });
    const prepared = await prepareScoutPitPhoto(file, { entryClientId: "entry-local-1" });
    expect(prepared.file).toBe(file);
    expect(prepared.thumb).toBeNull();
    expect(prepared.metadata.entryClientId).toBe("entry-local-1");
    expect(prepared.metadata.entryId).toBeNull();
    expect(prepared.metadata.hasThumb).toBe(false);
  });
});
