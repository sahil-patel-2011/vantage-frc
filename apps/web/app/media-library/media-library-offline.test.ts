import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Photos & video last snapshot stays on the phone", () => {
  it("reads and writes the media-library IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "media-library-client.tsx"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"media-library"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Photos & video"/);
  });
});
