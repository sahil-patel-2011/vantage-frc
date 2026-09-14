import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Alliance Sim / Partner Brief / Justifier / Watchlist /
 * Collaborative pick list / Defense Planner titles after leftover-hub-strips.
 * Hub labels stay Alliance sim, Partner brief, Justifier, Watchlist,
 * Pick list, and Defense. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/alliance-sim/alliance-sim-client.tsx",
  "app/alliance-sim/page.tsx",
  "app/api/alliance-sim/route.ts",
  "lib/manifests/alliance-sim.manifest.ts",
  "app/alliance-partner-brief/alliance-partner-brief-client.tsx",
  "app/alliance-partner-brief/page.tsx",
  "app/api/alliance-partner-brief/route.ts",
  "lib/alliance-partner-brief/alliance-partner-brief-related.ts",
  "lib/alliance-partner-brief/compute-alliance-partner-brief.ts",
  "lib/manifests/alliance-partner-brief.manifest.ts",
  "app/picklist-justifier/picklist-justifier-client.tsx",
  "app/picklist-justifier/page.tsx",
  "app/api/picklist-justifier/route.ts",
  "lib/picklist-justifier/picklist-justifier-related.ts",
  "lib/picklist-justifier/compute-picklist-justifier.ts",
  "lib/manifests/picklist-justifier.manifest.ts",
  "app/opponent-watchlist/opponent-watchlist-client.tsx",
  "app/opponent-watchlist/page.tsx",
  "lib/opponent-watchlist/opponent-watchlist-related.ts",
  "lib/opponent-watchlist/compute-opponent-watchlist.ts",
  "lib/manifests/opponent-watchlist.manifest.ts",
  "app/picklist-collab/picklist-collab-client.tsx",
  "app/picklist-collab/page.tsx",
  "lib/picklist-collab/picklist-collab-related.ts",
  "lib/manifests/picklist-collab.manifest.ts",
  "app/defense-planner/defense-planner-client.tsx",
  "app/defense-planner/page.tsx",
  "app/api/defense-planner/route.ts",
  "lib/defense-planner/defense-planner-related.ts",
  "lib/defense-planner/compute-defense-planner.ts",
  "lib/manifests/defense-planner.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student strategy-title chrome", () => {
  it("does not print leftover Sim / Brief / Justifier / Watchlist titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Alliance Sim/);
      expect(src, rel).not.toMatch(/Alliance-Partner Brief/);
      expect(src, rel).not.toMatch(/Pick-list Auto-Justifier/);
      expect(src, rel).not.toMatch(/Pick-list Justifier/);
      expect(src, rel).not.toMatch(/Opponent Watchlist/);
      expect(src, rel).not.toMatch(/Collaborative Pick List/);
      expect(src, rel).not.toMatch(/Collaborative pick list/);
      expect(src, rel).not.toMatch(/Defense Planner/);
      expect(src, rel).not.toMatch(/Defense planner/);
    }
    const sim = readFileSync(join(WEB, "app/alliance-sim/alliance-sim-client.tsx"), "utf8");
    expect(sim).toMatch(/title="Alliance sim"/);
    expect(sim).toMatch(/feature="Alliance sim"/);
    expect(sim).toMatch(/Opening Alliance sim/);
    const brief = readFileSync(join(WEB, "app/alliance-partner-brief/alliance-partner-brief-client.tsx"), "utf8");
    expect(brief).toMatch(/title="Partner brief"/);
    expect(brief).toMatch(/feature="Partner brief"/);
    const justifier = readFileSync(join(WEB, "app/picklist-justifier/picklist-justifier-client.tsx"), "utf8");
    expect(justifier).toMatch(/title="Justifier"/);
    expect(justifier).toMatch(/feature="Justifier"/);
    const watch = readFileSync(join(WEB, "app/opponent-watchlist/opponent-watchlist-client.tsx"), "utf8");
    expect(watch).toMatch(/title="Watchlist"/);
    expect(watch).toMatch(/feature="Watchlist"/);
    const picks = readFileSync(join(WEB, "app/picklist-collab/picklist-collab-client.tsx"), "utf8");
    expect(picks).toMatch(/title="Pick list"/);
    expect(picks).toMatch(/feature="Pick list"/);
    const defense = readFileSync(join(WEB, "app/defense-planner/defense-planner-client.tsx"), "utf8");
    expect(defense).toMatch(/title="Defense"/);
    expect(defense).toMatch(/feature="Defense"/);
  });
});
