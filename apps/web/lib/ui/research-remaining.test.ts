/**
 * Remaining Research / Overnight brief student chrome after honest prediction
 * landed. Not leftover-product, season-goals, relays, or code-vs-match.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEL_RELATED_INCLUDE, intelNextActions, intelShellCopy } from "../intel/intel-related";
import { overnightIntelNextActions, overnightIntelShellCopy } from "../overnight-intel/overnight-intel-related";
import { offlineCapableLabel } from "../offline/shell-routes";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const FILES = [
  "app/intel/intel-client.tsx",
  "app/intel/intel-chrome.tsx",
  "app/intel/intel-ready-view.tsx",
  "app/intel/page.tsx",
  "lib/intel/intel-related.ts",
  "app/overnight-intel/overnight-intel-client.tsx",
  "app/overnight-intel/overnight-intel-chrome.tsx",
  "app/overnight-intel/overnight-intel-panels.tsx",
  "lib/overnight-intel/overnight-intel-related.ts",
] as const;

describe("Research remaining student chrome", () => {
  it("does not print Setup required, EPA, or TBA dump on this slice", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/\bEPA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/className="primary-action"/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
    }
  });

  it("setup is Needs setup with one primary; last snapshot uses if (!view)", () => {
    expect(intelShellCopy("setup").badge).toBe("Needs setup");
    expect(overnightIntelShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(intelShellCopy("setup").description);
    expectPlainCopy(overnightIntelShellCopy("empty").description);

    const intel = readFileSync(join(WEB, "app/intel/intel-client.tsx"), "utf8");
    const overnight = readFileSync(join(WEB, "app/overnight-intel/overnight-intel-client.tsx"), "utf8");
    expect(intel).toMatch(/if \(!view\)/);
    expect(intel).toMatch(/fetchActiveOrgId/);
    expect(intel).toMatch(/getFeatureSnapshot/);
    expect(intel).toMatch(/putFeatureSnapshot/);
    expect(intel).toMatch(/orgId \|\| "_"/);
    expect(overnight).toMatch(/if \(!view\)/);
    expect(overnight).toMatch(/getFeatureSnapshot/);
    expect(offlineCapableLabel("/intel")).toBe("Research");
    expect(offlineCapableLabel("/overnight-intel")).toBe("Overnight brief");
  });

  it("empty/setup keep next-actions off; related stays Strategy · Dossier · Scouting", () => {
    expect([...INTEL_RELATED_INCLUDE]).toEqual(["strategy", "dossier", "scouting"]);
    expect(intelNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    expect(overnightIntelNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    const setup = intelNextActions({ orgId: null, shell: "setup" });
    expect(setup).toHaveLength(1);
    expect(setup[0]?.label).toBe("Choose your team");
  });
});
