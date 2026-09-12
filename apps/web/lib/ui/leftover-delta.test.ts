import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Match-Delta Watcher titles after leftover-video-more.
 * Hub label stays Match delta. leftover-video-more Video index,
 * leftover-match-more Pick clock / Match notes / Counter-book / Retro,
 * leftover-tool-more Tool checkout, leftover-build-more Parts relay /
 * Subsystem sign-off, leftover-fmea Failure log, leftover-pick Choose
 * your team, leftover-team-data Sync Team data, leftover-invites Invites,
 * leftover-visit-invites Visit invites, leftover-community-impact Impact,
 * leftover-event-day-more Event day, leftover-ops-more Skills / Risk
 * register / Burndown stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/match-delta-watcher/match-delta-watcher-client.tsx",
  "app/match-delta-watcher/page.tsx",
  "lib/match-delta-watcher/match-delta-watcher-related.ts",
  "app/api/match-delta-watcher/route.ts",
  "lib/manifests/match-delta-watcher.manifest.ts",
  "lib/offline/shell-routes.ts",
  "lib/match-video-index/match-video-index-related.ts",
] as const;

describe("leftover student delta chrome", () => {
  it("does not print leftover Match-Delta Watcher titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Match-Delta Watcher/);
      expect(src, rel).not.toMatch(/Match-Delta/);
      expect(src, rel).not.toMatch(/Match-delta watcher/);
    }
    const client = readFileSync(
      join(WEB, "app/match-delta-watcher/match-delta-watcher-client.tsx"),
      "utf8",
    );
    expect(client).toMatch(/title="Match delta"/);
    expect(client).toMatch(/feature="Match delta"/);
    expect(client).not.toMatch(/title="Loading/);
    const related = readFileSync(
      join(WEB, "lib/match-delta-watcher/match-delta-watcher-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Opening Match delta/);
    expect(related).toMatch(/Retry Match delta/);
    expect(related).toMatch(/Choose your team/);
    expect(related).toMatch(/Sync Team data/);
    expect(related).toMatch(/Event day/);
    expect(related).not.toMatch(/Event Day/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    const videoRelated = readFileSync(
      join(WEB, "lib/match-video-index/match-video-index-related.ts"),
      "utf8",
    );
    expect(videoRelated).toMatch(/Opening Video index/);
    expect(videoRelated).toMatch(/label: "Match notes"/);
    expect(videoRelated).toMatch(/label: "Open Match notes"/);
    expect(videoRelated).toMatch(/label: "Match delta"/);
    expect(videoRelated).toMatch(/label: "Open Match delta"/);
    expect(videoRelated).toMatch(/Choose your team/);
    const page = readFileSync(join(WEB, "app/match-delta-watcher/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Match delta"/);
    const route = readFileSync(join(WEB, "app/api/match-delta-watcher/route.ts"), "utf8");
    expect(route).toMatch(/Could not load Match delta/);
    expect(route).toMatch(/Match delta request failed/);
    expect(route).toMatch(/Choose your team/);
    const manifest = readFileSync(
      join(WEB, "lib/manifests/match-delta-watcher.manifest.ts"),
      "utf8",
    );
    expect(manifest).toMatch(/title: "Match delta"/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-delta-watcher"\)\) return "Match delta"/,
    );
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-video-index"\)\) return "Video index"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/team\/admin"\)\) return "Invites"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/visit-invites"\)\) return "Visit invites"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact"\)\) return "Impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/fmea"\)\) return "Failure log"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/parts-relay"\)\) return "Parts relay"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/subsystem-signoff"\)\) return "Subsystem sign-off"/,
    );
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/tool-checkout"\)\) return "Tool checkout"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/pick-clock"\)\) return "Pick clock"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-notes-timeline"\)\) return "Match notes"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/counter-book"\)\) return "Counter-book"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/retro"\)\) return "Retro"/);
  });
});
