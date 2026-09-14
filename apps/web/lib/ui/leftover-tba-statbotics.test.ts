import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dossierShellCopy } from "../dossier/dossier-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome that still named TBA/Statbotics/EPA after the
 * membership-bound TBA pass. Do not invent a last-snapshot here.
 */
const FILES = [
  "lib/dossier/dossier-related.ts",
  "app/dossier/dossier-client.tsx",
  "app/scout-crossval/scout-crossval-client.tsx",
  "app/degraded-mode/degraded-mode-client.tsx",
  "lib/degraded-mode/index.ts",
  "app/display/page.tsx",
  "components/ui/data-source-footer.tsx",
  "lib/pairwise/pairwise-next-actions.ts",
  "lib/district-trajectory-sim/compute-district-trajectory-sim.ts",
  "lib/alliance-partner-brief/index.ts",
] as const;

describe("leftover student TBA / Statbotics chrome", () => {
  it("does not print TBA, Statbotics, or Season EPA on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
    }
  });

  it("dossier setup stays Needs setup and student-readable", () => {
    expect(dossierShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(dossierShellCopy("setup").description);
    expectPlainCopy(dossierShellCopy("empty").description);
    expectPlainCopy(dossierShellCopy("ready").description);
  });
});
