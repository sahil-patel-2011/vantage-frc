import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Photos & video titles after leftover-cad-map.
 * Business hub label stays Photos & video. Hidden hub Media library
 * stays in hubs.ts for search/help/access. Drive folder names stay
 * Media Library. Routes stay. leftover-fmea Failure log and
 * leftover-pick-before Choose your team stay. leftover-help-workspace
 * Connect TBA stays. Do not invent a last-snapshot.
 */
const FILES = [
  "app/media-library/media-library-client.tsx",
  "app/media-library/page.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student media chrome", () => {
  it("does not print leftover Media Library student titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Media Library/);
    }
    const client = readFileSync(
      join(WEB, "app/media-library/media-library-client.tsx"),
      "utf8",
    );
    expect(client).toMatch(/title="Photos & video"/);
    expect(client).toMatch(/feature="Photos & video"/);
    expect(client).toMatch(/Choose your team/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/media-library"\)\) return "Photos & video"/);
  });
});
