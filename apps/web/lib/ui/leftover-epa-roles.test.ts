import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EPA / Setup required chrome after the Team Data health
 * pass. Identifiers like totalEpa stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/picklist-collab/picklist-collab-client.tsx",
  "app/pairwise/pairwise-client.tsx",
  "lib/chemistry/promote-to-pick-list.ts",
  "lib/match-sim/index.ts",
  "lib/marketing/demo-fixtures.ts",
] as const;

describe("leftover student EPA roles / marketing setup chrome", () => {
  it("does not print leftover EPA phrases or Setup required on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/FAST-style/);
      expect(src, rel).not.toMatch(/FAST-style EPA/);
      expect(src, rel).not.toMatch(/or EPA\./);
      expect(src, rel).not.toMatch(/not EPA/);
      expect(src, rel).not.toMatch(/real EPA data/);
      expect(src, rel).not.toMatch(/EPA to attribute/);
      expect(src, rel).not.toMatch(/extras\.push\(`EPA /);
    }
  });

  it("keeps student-readable season-rating and Needs setup copy", () => {
    const promote = readFileSync(join(WEB, "lib/chemistry/promote-to-pick-list.ts"), "utf8");
    const pairwise = readFileSync(join(WEB, "app/pairwise/pairwise-client.tsx"), "utf8");
    const marketing = readFileSync(join(WEB, "lib/marketing/demo-fixtures.ts"), "utf8");
    const collab = readFileSync(join(WEB, "app/picklist-collab/picklist-collab-client.tsx"), "utf8");
    expect(promote).toMatch(/season rating \$\{input\.fit\.totalEpa\}/);
    expect(pairwise).toMatch(/season ratings/);
    expect(marketing).toMatch(/Needs setup/);
    expect(collab).toMatch(/season ratings/);
    expect(collab).not.toMatch(/FAST-style/);
  });
});
