import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_SCOUT_PHOTO_INPUT_BYTES,
  SCOUT_PHOTO_MAX_EDGE,
  SCOUT_PHOTO_THUMB_EDGE,
  ScoutPhotoError,
  normalizeScoutPhoto,
  scoutPhotoErrorStatus,
  sha256Hex,
} from "./normalize-scout-photo";

async function solidJpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  let pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg({ quality: 80 });
  if (orientation) pipeline = pipeline.withMetadata({ orientation });
  return pipeline.toBuffer();
}

async function expectError(promise: Promise<unknown>, code: ScoutPhotoError["code"]) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ScoutPhotoError);
    expect((error as ScoutPhotoError).code).toBe(code);
    return error as ScoutPhotoError;
  }
  throw new Error(`expected ScoutPhotoError(${code})`);
}

describe("normalizeScoutPhoto", () => {
  it("applies EXIF orientation so a portrait phone shot stops coming out sideways", async () => {
    // 400x200 pixels tagged orientation 6 (rotate 90° CW) => displayed 200x400.
    const raw = await solidJpeg(400, 200, 6);
    const rawMeta = await sharp(raw).metadata();
    expect(rawMeta.orientation).toBe(6);

    const result = await normalizeScoutPhoto(raw);
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
    expect(result.contentType).toBe("image/webp");

    // Output is upright and carries no EXIF at all (orientation stripped).
    const outMeta = await sharp(result.full).metadata();
    expect(outMeta.format).toBe("webp");
    expect(outMeta.width).toBe(200);
    expect(outMeta.height).toBe(400);
    expect(outMeta.orientation).toBeUndefined();
    expect(outMeta.exif).toBeUndefined();
  }, 20_000);

  it("resizes inside the max edge and produces a thumb inside the thumb edge", async () => {
    const raw = await solidJpeg(3200, 2400);
    const result = await normalizeScoutPhoto(raw);
    expect(Math.max(result.width, result.height)).toBe(SCOUT_PHOTO_MAX_EDGE);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
    expect(Math.max(result.thumbWidth, result.thumbHeight)).toBe(SCOUT_PHOTO_THUMB_EDGE);
    expect(result.thumbWidth).toBe(320);
    expect(result.thumbHeight).toBe(240);
    expect(result.thumb.byteLength).toBeGreaterThan(0);
    expect(result.thumb.byteLength).toBeLessThan(result.full.byteLength);
    expect(result.byteSize).toBe(result.full.byteLength);
  }, 20_000);

  it("never enlarges a small photo", async () => {
    const raw = await solidJpeg(240, 180);
    const result = await normalizeScoutPhoto(raw);
    expect(result.width).toBe(240);
    expect(result.height).toBe(180);
    expect(result.thumbWidth).toBe(240);
    expect(result.thumbHeight).toBe(180);
  });

  it("checksums the normalized full deterministically", async () => {
    const raw = await solidJpeg(640, 480);
    const first = await normalizeScoutPhoto(raw);
    const second = await normalizeScoutPhoto(Buffer.from(raw));
    expect(first.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.checksumSha256).toBe(second.checksumSha256);
    expect(first.checksumSha256).toBe(sha256Hex(first.full));
  });

  it("rejects non-image bytes with a 415-mapped error", async () => {
    const error = await expectError(
      normalizeScoutPhoto(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")),
      "not_image",
    );
    expect(scoutPhotoErrorStatus(error)).toBe(415);
    await expectError(normalizeScoutPhoto(Buffer.from("%PDF-1.4 not a photo")), "not_image");
  });

  it("rejects an empty body", async () => {
    const error = await expectError(normalizeScoutPhoto(Buffer.alloc(0)), "empty");
    expect(scoutPhotoErrorStatus(error)).toBe(400);
  });

  it("rejects oversize input before decoding", async () => {
    // JPEG magic followed by junk — over the cap, so the size check fires first.
    const oversize = Buffer.alloc(MAX_SCOUT_PHOTO_INPUT_BYTES + 1, 0x00);
    oversize[0] = 0xff;
    oversize[1] = 0xd8;
    oversize[2] = 0xff;
    const error = await expectError(normalizeScoutPhoto(oversize), "too_large");
    expect(scoutPhotoErrorStatus(error)).toBe(413);
  });

  it("rejects a truncated image as decode_failed rather than crashing", async () => {
    const raw = await solidJpeg(800, 600);
    const truncated = raw.subarray(0, 64);
    await expectError(normalizeScoutPhoto(truncated), "decode_failed");
  });
});
