import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Accuracy / Cross-check / Disagreements / Data impact /
 * Heat signals / Assisted count titles after leftover-safety.
 * Hub labels stay Accuracy, Cross-check, Disagreements, Data impact,
 * Heat signals, and Assisted count. leftover-scout-titles Coverage /
 * Shifts / Pit link / Field value / Data quality / Pairwise stay.
 * leftover-pick-before Choose your team, leftover-fmea Failure log,
 * leftover-help-workspace Connect TBA, leftover-media Photos & video,
 * leftover-safety Safety incidents stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/scout-accuracy/scout-accuracy-client.tsx",
  "app/scout-accuracy/page.tsx",
  "lib/manifests/scout-accuracy.manifest.ts",
  "app/scout-crossval/scout-crossval-client.tsx",
  "app/scout-crossval/page.tsx",
  "lib/manifests/scout-crossval.manifest.ts",
  "app/scout-disagreements/scout-disagreements-client.tsx",
  "app/scout-disagreements/page.tsx",
  "lib/manifests/scout-disagreements.manifest.ts",
  "app/scout-data-impact/scout-data-impact-client.tsx",
  "app/scout-data-impact/page.tsx",
  "lib/manifests/scout-data-impact.manifest.ts",
  "app/scouting-heat-signals/scouting-heat-signals-client.tsx",
  "app/scouting-heat-signals/page.tsx",
  "lib/manifests/scouting-heat-signals.manifest.ts",
  "lib/scouting-heat-signals/scouting-heat-signals-related.ts",
  "app/scout-assisted-count/scout-assisted-count-client.tsx",
  "app/scout-assisted-count/page.tsx",
  "lib/manifests/scout-assisted-count.manifest.ts",
  "lib/scout-assisted-count/scout-assisted-count-related.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student scout-more chrome", () => {
  it("does not print leftover Scout Accuracy / Cross-Validation titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Scout Accuracy/);
      expect(src, rel).not.toMatch(/Scout Cross-Validation/);
      expect(src, rel).not.toMatch(/Scout Disagreements/);
      expect(src, rel).not.toMatch(/Scout Data Impact/);
      expect(src, rel).not.toMatch(/Scouting Heat Signals/);
      expect(src, rel).not.toMatch(/Scout-Assisted Count/);
    }
    const accuracy = readFileSync(
      join(WEB, "app/scout-accuracy/scout-accuracy-client.tsx"),
      "utf8",
    );
    expect(accuracy).toMatch(/title="Accuracy"/);
    expect(accuracy).toMatch(/feature="Accuracy"/);
    const crossval = readFileSync(
      join(WEB, "app/scout-crossval/scout-crossval-client.tsx"),
      "utf8",
    );
    expect(crossval).toMatch(/title="Cross-check"/);
    expect(crossval).toMatch(/feature="Cross-check"/);
    expect(crossval).not.toMatch(/\bTBA\b/);
    const disagreements = readFileSync(
      join(WEB, "app/scout-disagreements/scout-disagreements-client.tsx"),
      "utf8",
    );
    expect(disagreements).toMatch(/title="Disagreements"/);
    expect(disagreements).toMatch(/feature="Disagreements"/);
    const impact = readFileSync(
      join(WEB, "app/scout-data-impact/scout-data-impact-client.tsx"),
      "utf8",
    );
    expect(impact).toMatch(/title="Data impact"/);
    expect(impact).toMatch(/feature="Data impact"/);
    const heat = readFileSync(
      join(WEB, "app/scouting-heat-signals/scouting-heat-signals-client.tsx"),
      "utf8",
    );
    expect(heat).toMatch(/title="Heat signals"/);
    expect(heat).toMatch(/feature="Heat signals"/);
    const heatRelated = readFileSync(
      join(WEB, "lib/scouting-heat-signals/scouting-heat-signals-related.ts"),
      "utf8",
    );
    expect(heatRelated).toMatch(/Opening Heat signals/);
    expect(heatRelated).not.toMatch(/title="Loading/);
    expect(heatRelated).toMatch(/Choose your team/);
    expect(heatRelated).not.toMatch(/\bPick a team\b/);
    const assisted = readFileSync(
      join(WEB, "app/scout-assisted-count/scout-assisted-count-client.tsx"),
      "utf8",
    );
    expect(assisted).toMatch(/title="Assisted count"/);
    expect(assisted).toMatch(/feature="Assisted count"/);
    expect(assisted).toMatch(/Opening Assisted count/);
    const assistedRelated = readFileSync(
      join(WEB, "lib/scout-assisted-count/scout-assisted-count-related.ts"),
      "utf8",
    );
    expect(assistedRelated).toMatch(/Opening Assisted count/);
    expect(assistedRelated).not.toMatch(/title="Loading/);
    expect(assistedRelated).toMatch(/Choose your team/);
    expect(assistedRelated).not.toMatch(/\bPick a team\b/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scout-accuracy"\)\) return "Accuracy"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scout-crossval"\)\) return "Cross-check"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scout-disagreements"\)\) return "Disagreements"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scout-data-impact"\)\) return "Data impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scouting-heat-signals"\)\) return "Heat signals"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/scout-assisted-count"\)\) return "Assisted count"/);
  });
});
