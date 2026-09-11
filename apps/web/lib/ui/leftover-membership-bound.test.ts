import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on Scout Accuracy / Data impact / Lineup / Match video
 * that is not skip-list and not in open PRs #2–#38. Related.ts files owned by
 * #33 still say membership-bound until that PR lands its own copy pass.
 */
const FILES = [
  "app/scout-accuracy/scout-accuracy-client.tsx",
  "app/scout-data-impact/scout-data-impact-client.tsx",
  "app/scouting/lineup/lineup-client.tsx",
  "lib/scouting/lineup-related.ts",
  "lib/video-rescout-related.ts",
] as const;

describe("leftover student membership-bound chrome", () => {
  it("does not say membership-bound, membership IDs, or pick-desk ready", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/membership-bound/i);
      expect(src, rel).not.toMatch(/membership IDs/i);
      expect(src, rel).not.toMatch(/pick-desk ready/i);
    }
  });
});
