import { describe, expect, it } from "vitest";
import {
  SCOUT_MEDIA_FILE_MISSING,
  SCOUT_MEDIA_THUMB_MISSING,
  isScoutMediaThumbColumnMissing,
  parseScoutMediaGetVariant,
  pickScoutMediaGetPayload,
  resolveScoutMediaPreview,
  scoutMediaFileUrl,
  scoutMediaPreviewHasImage,
} from "./scout-media-preview";

describe("scoutMediaFileUrl", () => {
  it("scopes the real media route to the org and only asks for a thumb when told", () => {
    expect(scoutMediaFileUrl("org-1", "img-1")).toBe("/api/scouting/media/img-1?orgId=org-1");
    expect(scoutMediaFileUrl("org-1", "img-1", "thumb")).toBe(
      "/api/scouting/media/img-1?orgId=org-1&variant=thumb",
    );
  });
});

describe("resolveScoutMediaPreview", () => {
  it("prefers the local queued blob so a tablet can show the real capture offline", () => {
    const preview = resolveScoutMediaPreview({
      orgId: "org-1",
      clientId: "img-1",
      hasLocalBlob: true,
      hasLocalThumb: true,
      online: false,
      uploaded: false,
    });
    expect(preview).toEqual({
      status: "local",
      src: null,
      kind: "blob",
      hasThumb: true,
    });
    expect(scoutMediaPreviewHasImage(preview)).toBe(true);
  });

  it("does not point at the server while offline with no local blob", () => {
    const preview = resolveScoutMediaPreview({
      orgId: "org-1",
      clientId: "img-1",
      hasLocalBlob: false,
      online: false,
      uploaded: true,
      hasRemoteThumb: true,
    });
    expect(preview.status).toBe("missing");
    expect(preview.src).toBeNull();
    expect(scoutMediaPreviewHasImage(preview)).toBe(false);
  });

  it("does not assume a photo exists just because we have a clientId", () => {
    const preview = resolveScoutMediaPreview({
      orgId: "org-1",
      clientId: "img-1",
      hasLocalBlob: false,
      online: true,
    });
    expect(preview).toEqual({
      status: "missing",
      src: null,
      reason: "This photo has not uploaded yet.",
    });
  });

  it("uses a remote thumb only when the server actually has one", () => {
    const withThumb = resolveScoutMediaPreview({
      orgId: "org-1",
      clientId: "img-1",
      hasLocalBlob: false,
      online: true,
      uploaded: true,
      hasRemoteThumb: true,
    });
    expect(withThumb).toEqual({
      status: "remote",
      src: "/api/scouting/media/img-1?orgId=org-1&variant=thumb",
      variant: "thumb",
    });

    const fullOnly = resolveScoutMediaPreview({
      orgId: "org-1",
      clientId: "img-1",
      hasLocalBlob: false,
      online: true,
      uploaded: true,
      hasRemoteThumb: false,
    });
    expect(fullOnly).toEqual({
      status: "remote",
      src: "/api/scouting/media/img-1?orgId=org-1",
      variant: "full",
    });
  });

  it("never invents a DEMO src for a blank id", () => {
    const preview = resolveScoutMediaPreview({
      orgId: "",
      clientId: "img-1",
      hasLocalBlob: false,
      uploaded: true,
      online: true,
    });
    expect(preview.status).toBe("missing");
    expect(preview.src).toBeNull();
  });
});

describe("parseScoutMediaGetVariant", () => {
  it("only treats the literal thumb query as a thumb request", () => {
    expect(parseScoutMediaGetVariant("thumb")).toBe("thumb");
    expect(parseScoutMediaGetVariant("full")).toBe("full");
    expect(parseScoutMediaGetVariant(null)).toBe("full");
    expect(parseScoutMediaGetVariant("demo")).toBe("full");
  });
});

describe("pickScoutMediaGetPayload", () => {
  const full = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
  const thumb = new Uint8Array([0xff, 0xd8, 0xff, 0x02]);

  it("returns the stored thumb when variant=thumb and thumb_bytes is present", () => {
    const payload = pickScoutMediaGetPayload(
      { contentType: "image/jpeg", bytes: full, thumbBytes: thumb },
      "thumb",
    );
    expect(payload).toEqual({
      status: "ok",
      body: thumb,
      contentType: "image/jpeg",
      variant: "thumb",
    });
  });

  it("404s honestly when variant=thumb and thumb_bytes is missing — never the original, never a DEMO jpeg", () => {
    const payload = pickScoutMediaGetPayload(
      { contentType: "image/jpeg", bytes: full, thumbBytes: null },
      "thumb",
    );
    expect(payload).toEqual({ status: "missing", reason: SCOUT_MEDIA_THUMB_MISSING });
    expect(payload).not.toHaveProperty("body");
  });

  it("treats an empty thumb_bytes the same as missing", () => {
    const payload = pickScoutMediaGetPayload(
      { bytes: full, thumbBytes: new Uint8Array(0) },
      "thumb",
    );
    expect(payload.status).toBe("missing");
    expect(payload.reason).toBe(SCOUT_MEDIA_THUMB_MISSING);
  });

  it("serves the original only when variant is full and bytes exist", () => {
    const payload = pickScoutMediaGetPayload(
      { contentType: "image/jpeg", bytes: full, thumbBytes: thumb },
      "full",
    );
    expect(payload).toEqual({
      status: "ok",
      body: full,
      contentType: "image/jpeg",
      variant: "full",
    });
  });

  it("does not invent bytes when the uploaded file itself is missing", () => {
    const payload = pickScoutMediaGetPayload({ contentType: "image/jpeg", bytes: null }, "full");
    expect(payload).toEqual({ status: "missing", reason: SCOUT_MEDIA_FILE_MISSING });
  });
});

describe("isScoutMediaThumbColumnMissing", () => {
  it("treats a pre-0509 deploy as no thumb, not a DEMO jpeg", () => {
    expect(
      isScoutMediaThumbColumnMissing(new Error('column "thumb_bytes" does not exist')),
    ).toBe(true);
    expect(isScoutMediaThumbColumnMissing(new Error("42703 undefined_column"))).toBe(true);
    expect(isScoutMediaThumbColumnMissing(new Error("Media not found"))).toBe(false);
  });
});
