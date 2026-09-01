import { describe, expect, it } from "vitest";
import {
  PHOTO_DB_CAP_BYTES,
  VIDEO_DB_CAP_BYTES,
  VIDEO_SCHEMA_CAP_BYTES,
  dbCapForKind,
  formatMediaBytes,
  hostedCapForKind,
  isAllowedContentType,
  isSha256Hex,
  mediaKindForContentType,
  oversizeUploadMessage,
  validateUploadMetadata,
} from "./validation";

const SHA = "a".repeat(64);

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentType: "image/jpeg",
    byteSize: 1024,
    sha256: SHA,
    title: "Robot on the field",
    ...overrides,
  };
}

describe("mediaKindForContentType", () => {
  it("maps image formats to photo and video formats to video", () => {
    expect(mediaKindForContentType("image/jpeg")).toBe("photo");
    expect(mediaKindForContentType("image/png")).toBe("photo");
    expect(mediaKindForContentType("image/webp")).toBe("photo");
    expect(mediaKindForContentType("video/mp4")).toBe("video");
    expect(mediaKindForContentType("video/webm")).toBe("video");
  });

  it("rejects unsupported formats", () => {
    expect(mediaKindForContentType("image/gif")).toBeNull();
    expect(mediaKindForContentType("video/quicktime")).toBeNull();
    expect(mediaKindForContentType("application/pdf")).toBeNull();
    expect(mediaKindForContentType(null)).toBeNull();
  });
});

describe("isAllowedContentType", () => {
  it("only allows the CHECK-limited formats", () => {
    expect(isAllowedContentType("image/jpeg")).toBe(true);
    expect(isAllowedContentType("video/webm")).toBe(true);
    expect(isAllowedContentType("image/svg+xml")).toBe(false);
    expect(isAllowedContentType(42)).toBe(false);
  });
});

describe("isSha256Hex", () => {
  it("accepts 64 lowercase hex chars only", () => {
    expect(isSha256Hex(SHA)).toBe(true);
    expect(isSha256Hex(SHA.toUpperCase())).toBe(false);
    expect(isSha256Hex(SHA.slice(1))).toBe(false);
    expect(isSha256Hex(`${SHA}0`)).toBe(false);
  });
});

describe("validateUploadMetadata", () => {
  it("accepts a minimal valid photo", () => {
    const result = validateUploadMetadata(base());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("photo");
      expect(result.value.title).toBe("Robot on the field");
      expect(result.value.albumId).toBeNull();
    }
  });

  it("rejects a photo over the 8MB db cap with the real numbers", () => {
    const result = validateUploadMetadata(base({ byteSize: PHOTO_DB_CAP_BYTES + 1 }), {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("8.0 MB");
  });

  it("refuses 6–100 MB video on hosted Vercel instead of claiming the 100 MB schema cap", () => {
    const hosted = { VERCEL: "1" };
    const sixMb = validateUploadMetadata(
      base({ contentType: "video/mp4", byteSize: 6 * 1024 * 1024 }),
      hosted,
    );
    expect(sixMb.ok).toBe(false);
    if (!sixMb.ok) {
      expect(sixMb.error).toContain("4.0 MB");
      expect(sixMb.error).toContain("storage node");
      expect(sixMb.error).not.toContain("100.0 MB");
    }
    const atHostedCap = validateUploadMetadata(
      base({ contentType: "video/mp4", byteSize: VIDEO_DB_CAP_BYTES }),
      hosted,
    );
    expect(atHostedCap.ok).toBe(true);
  });

  it("accepts a video up to the 100MB schema cap off Vercel and rejects above it", () => {
    const selfHosted = {};
    const ok = validateUploadMetadata(
      base({ contentType: "video/mp4", byteSize: VIDEO_SCHEMA_CAP_BYTES }),
      selfHosted,
    );
    expect(ok.ok).toBe(true);
    const over = validateUploadMetadata(
      base({ contentType: "video/mp4", byteSize: VIDEO_SCHEMA_CAP_BYTES + 1 }),
      selfHosted,
    );
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.error).toContain("100.0 MB");
      expect(over.error).toContain("storage node");
    }
  });

  it("rejects kind/content-type mismatches", () => {
    const result = validateUploadMetadata(base({ kind: "video" }));
    expect(result.ok).toBe(false);
  });

  it("rejects missing title, bad checksum, and bad sizes", () => {
    expect(validateUploadMetadata(base({ title: "   " })).ok).toBe(false);
    expect(validateUploadMetadata(base({ sha256: "nope" })).ok).toBe(false);
    expect(validateUploadMetadata(base({ byteSize: 0 })).ok).toBe(false);
    expect(validateUploadMetadata(base({ byteSize: "big" })).ok).toBe(false);
  });

  it("normalizes optional fields and drops invalid ones", () => {
    const result = validateUploadMetadata(
      base({
        eventKey: "  2026onosh  ",
        subteam: "media crew",
        width: 1600.4,
        height: -5,
        durationSeconds: 12.345,
        takenAt: "2026-03-14T10:00:00.000Z",
        contentType: "video/webm",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.eventKey).toBe("2026onosh");
      expect(result.value.subteam).toBe("media crew");
      expect(result.value.width).toBe(1600);
      expect(result.value.height).toBeNull();
      expect(result.value.durationSeconds).toBeCloseTo(12.35);
      expect(result.value.takenAt).toBe("2026-03-14T10:00:00.000Z");
    }
  });
});

describe("caps and formatting", () => {
  it("returns the right cap per kind", () => {
    expect(dbCapForKind("photo")).toBe(8 * 1024 * 1024);
    expect(dbCapForKind("video")).toBe(100 * 1024 * 1024);
    expect(VIDEO_DB_CAP_BYTES).toBe(4 * 1024 * 1024);
    expect(VIDEO_SCHEMA_CAP_BYTES).toBe(100 * 1024 * 1024);
    expect(hostedCapForKind("video", { VERCEL: "1" })).toBe(4 * 1024 * 1024);
    expect(hostedCapForKind("video", {})).toBe(100 * 1024 * 1024);
  });

  it("formats sizes across units", () => {
    expect(formatMediaBytes(512)).toBe("512 B");
    expect(formatMediaBytes(2048)).toBe("2 KB");
    expect(formatMediaBytes(8 * 1024 * 1024)).toBe("8.0 MB");
    expect(formatMediaBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.50 GB");
    expect(formatMediaBytes(-3)).toBe("0 B");
  });

  it("oversize messages always name the actual size", () => {
    expect(oversizeUploadMessage("photo", 9 * 1024 * 1024, {})).toContain("9.0 MB");
    const video = oversizeUploadMessage("video", 250 * 1024 * 1024, {});
    expect(video).toContain("250.0 MB");
    expect(video).toContain("YouTube");
  });

  it("names 4.0 MB — not 100 MB — when a hosted video is over the cloud cap", () => {
    const hosted = oversizeUploadMessage("video", 20 * 1024 * 1024, { VERCEL: "1" });
    expect(hosted).toContain("20.0 MB");
    expect(hosted).toContain("4.0 MB");
    expect(hosted).not.toContain("100.0 MB");
    const fromClient = oversizeUploadMessage("video", 20 * 1024 * 1024, {});
    expect(fromClient).toContain("4.0 MB");
  });
});
