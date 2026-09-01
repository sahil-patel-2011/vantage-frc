import { describe, expect, it } from "vitest";
import {
  DB_ROW_CAP_BYTES,
  VERCEL_BODY_LIMIT_BYTES,
  VERCEL_SAFE_UPLOAD_BYTES,
  cloudUploadCapBytes,
  platformUploadCeilingBytes,
} from "./caps";

const FOUR_MIB = 4 * 1024 * 1024;
const HUNDRED_MIB = 100 * 1024 * 1024;

describe("platform ceilings", () => {
  it("pins the Vercel-safe cloud cap at 4 MiB, under the 4.5 MB edge limit", () => {
    expect(VERCEL_SAFE_UPLOAD_BYTES).toBe(FOUR_MIB);
    expect(VERCEL_BODY_LIMIT_BYTES).toBe(4.5 * 1024 * 1024);
    expect(VERCEL_SAFE_UPLOAD_BYTES).toBeLessThan(VERCEL_BODY_LIMIT_BYTES);
    expect(DB_ROW_CAP_BYTES).toBe(HUNDRED_MIB);
  });

  it("uses 4 MiB on Vercel and the 100 MiB schema ceiling off it", () => {
    expect(platformUploadCeilingBytes({ VERCEL: "1" })).toBe(FOUR_MIB);
    expect(platformUploadCeilingBytes({})).toBe(HUNDRED_MIB);
  });
});

describe("cloudUploadCapBytes", () => {
  it("never claims 100 MB on Vercel — even when an override asks for it", () => {
    expect(cloudUploadCapBytes({ VERCEL: "1" })).toBe(FOUR_MIB);
    expect(cloudUploadCapBytes({ VERCEL: "1", STORAGE_CLOUD_UPLOAD_CAP_BYTES: String(HUNDRED_MIB) })).toBe(
      FOUR_MIB,
    );
    expect(cloudUploadCapBytes({ VERCEL: "1", STORAGE_CLOUD_UPLOAD_CAP_BYTES: String(6 * 1024 * 1024) })).toBe(
      FOUR_MIB,
    );
  });

  it("honors a lower override on Vercel and off it", () => {
    expect(cloudUploadCapBytes({ VERCEL: "1", STORAGE_CLOUD_UPLOAD_CAP_BYTES: "1048576" })).toBe(1 * 1024 * 1024);
    expect(cloudUploadCapBytes({ STORAGE_CLOUD_UPLOAD_CAP_BYTES: "1048576" })).toBe(1 * 1024 * 1024);
  });

  it("uses the schema ceiling off Vercel and clamps an override to it", () => {
    expect(cloudUploadCapBytes({})).toBe(HUNDRED_MIB);
    expect(cloudUploadCapBytes({ STORAGE_CLOUD_UPLOAD_CAP_BYTES: String(200 * 1024 * 1024) })).toBe(
      HUNDRED_MIB,
    );
  });

  it("ignores a non-positive or non-numeric override", () => {
    expect(cloudUploadCapBytes({ VERCEL: "1", STORAGE_CLOUD_UPLOAD_CAP_BYTES: "0" })).toBe(FOUR_MIB);
    expect(cloudUploadCapBytes({ STORAGE_CLOUD_UPLOAD_CAP_BYTES: "nope" })).toBe(HUNDRED_MIB);
  });
});
