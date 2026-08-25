import { describe, expect, it } from "vitest";
import {
  DOWNSCALE_MAX_EDGE,
  MAX_SCOUT_MEDIA_BYTES,
  downscaleDimensions,
  exceedsMediaCap,
  formatByteSize,
  isDownscalableImageType,
  mediaKindLabel,
  oversizeMediaReason,
} from "./media-downscale";

describe("downscaleDimensions", () => {
  it("leaves images under the max edge untouched", () => {
    expect(downscaleDimensions(1200, 900)).toEqual({ width: 1200, height: 900, scaled: false });
    expect(downscaleDimensions(1600, 1600)).toEqual({ width: 1600, height: 1600, scaled: false });
  });

  it("never upscales small images", () => {
    expect(downscaleDimensions(320, 240)).toEqual({ width: 320, height: 240, scaled: false });
  });

  it("shrinks a landscape phone photo so the long edge is the cap", () => {
    const result = downscaleDimensions(4032, 3024);
    expect(result.scaled).toBe(true);
    expect(result.width).toBe(DOWNSCALE_MAX_EDGE);
    expect(result.height).toBe(1200);
  });

  it("shrinks portrait photos on the long edge and preserves aspect ratio", () => {
    const result = downscaleDimensions(3024, 4032);
    expect(result).toEqual({ width: 1200, height: 1600, scaled: true });
    expect(result.width / result.height).toBeCloseTo(3024 / 4032, 2);
  });

  it("handles extreme aspect ratios without collapsing to zero", () => {
    const result = downscaleDimensions(20000, 10);
    expect(result.scaled).toBe(true);
    expect(result.width).toBe(1600);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it("honors a custom max edge", () => {
    expect(downscaleDimensions(1000, 500, 100)).toEqual({ width: 100, height: 50, scaled: true });
  });

  it("collapses invalid input to 0x0 unscaled", () => {
    expect(downscaleDimensions(0, 100)).toEqual({ width: 0, height: 0, scaled: false });
    expect(downscaleDimensions(Number.NaN, 100)).toEqual({ width: 0, height: 0, scaled: false });
    expect(downscaleDimensions(100, -5)).toEqual({ width: 0, height: 0, scaled: false });
    expect(downscaleDimensions(100, 100, 0)).toEqual({ width: 0, height: 0, scaled: false });
  });

  it("rounds fractional source dimensions", () => {
    expect(downscaleDimensions(1500.6, 900.2)).toEqual({ width: 1501, height: 900, scaled: false });
  });
});

describe("isDownscalableImageType", () => {
  it("accepts raster stills", () => {
    expect(isDownscalableImageType("image/jpeg")).toBe(true);
    expect(isDownscalableImageType("image/png")).toBe(true);
    expect(isDownscalableImageType("image/webp")).toBe(true);
  });

  it("rejects animated / vector / non-image types", () => {
    expect(isDownscalableImageType("image/gif")).toBe(false);
    expect(isDownscalableImageType("image/svg+xml")).toBe(false);
    expect(isDownscalableImageType("video/mp4")).toBe(false);
    expect(isDownscalableImageType("audio/webm")).toBe(false);
    expect(isDownscalableImageType("")).toBe(false);
    expect(isDownscalableImageType(null)).toBe(false);
  });
});

describe("size formatting and caps", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatByteSize(96)).toBe("96 B");
    expect(formatByteSize(421_888)).toBe("412 KB");
    expect(formatByteSize(8_808_038)).toBe("8.4 MB");
    expect(formatByteSize(MAX_SCOUT_MEDIA_BYTES)).toBe("6.0 MB");
    expect(formatByteSize(-1)).toBe("0 B");
    expect(formatByteSize(Number.NaN)).toBe("0 B");
  });

  it("flags only sizes strictly over the cap", () => {
    expect(exceedsMediaCap(MAX_SCOUT_MEDIA_BYTES)).toBe(false);
    expect(exceedsMediaCap(MAX_SCOUT_MEDIA_BYTES + 1)).toBe(true);
    expect(exceedsMediaCap(Number.NaN)).toBe(false);
  });

  it("builds an oversize reason that names the actual size and the cap", () => {
    const reason = oversizeMediaReason(8_808_038, "Photo");
    expect(reason).toContain("8.4 MB");
    expect(reason).toContain("6.0 MB");
    expect(reason.startsWith("Photo is")).toBe(true);
  });

  it("labels media kinds for the attention panel", () => {
    expect(mediaKindLabel("photo")).toBe("Photo");
    expect(mediaKindLabel("video")).toBe("Video");
    expect(mediaKindLabel("audio")).toBe("Audio clip");
    expect(mediaKindLabel(undefined)).toBe("File");
  });
});
