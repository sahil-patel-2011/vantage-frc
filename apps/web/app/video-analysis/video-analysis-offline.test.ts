import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Video last snapshot stays on the phone", () => {
  it("reads and writes the video-analysis IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "video-analysis-client.tsx"), "utf8");
    expect(src).toMatch(/useOfflineSnapshot<VideoAnalysisSnapshot>\("video-analysis"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/feature="Video"/);
    expect(src).not.toMatch(/fetchFailed \|\| !view/);
    expect(src).not.toMatch(/fetchFailed \|\| view == null/);
    expect(src).toMatch(/snapshot\.loading && jobs\.length === 0/);
    expect(src).toMatch(/fetchFailed && jobs\.length === 0/);
  });
});
