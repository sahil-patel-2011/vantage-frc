import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on Scout Accuracy / Data impact / Lineup / Match video
 * plus coverage / crossval / disagreements related copy. Do not invent a
 * last-snapshot here — only drop membership-bound and TBA.
 */
const FILES = [
  "app/scout-accuracy/scout-accuracy-client.tsx",
  "app/scout-data-impact/scout-data-impact-client.tsx",
  "app/scouting/lineup/lineup-client.tsx",
  "lib/scouting/lineup-related.ts",
  "lib/video-rescout-related.ts",
  "lib/scout-accuracy/scout-accuracy-related.ts",
  "lib/scout-data-impact/scout-data-impact-related.ts",
  "lib/scout-coverage-live/scout-coverage-live-related.ts",
  "lib/scout-crossval/scout-crossval-related.ts",
  "lib/scout-disagreements/scout-disagreements-related.ts",
] as const;

describe("leftover student membership-bound chrome", () => {
  it("does not say membership-bound, membership IDs, or pick-desk ready", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/membership-bound/i);
      expect(src, rel).not.toMatch(/membership IDs/i);
      expect(src, rel).not.toMatch(/pick-desk ready/i);
      expect(src, rel).not.toMatch(/\bTBA\b/);
    }
  });
});
