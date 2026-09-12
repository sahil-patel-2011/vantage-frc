import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Match Video Index titles after leftover-match-more.
 * Hub label stays Video index. leftover-match-more Pick clock / Match
 * notes / Counter-book / Retro, leftover-tool-more Tool checkout,
 * leftover-build-more Parts relay / Subsystem sign-off, leftover-fmea
 * Failure log, leftover-pick Choose your team, leftover-invites Invites,
 * leftover-visit-invites Visit invites, leftover-community-impact Impact,
 * leftover-event-day-more Event day, leftover-ops-more Skills / Risk
 * register / Burndown stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/match-video-index/match-video-index-client.tsx",
  "app/match-video-index/page.tsx",
  "lib/match-video-index/match-video-index-related.ts",
  "app/api/match-video-index/route.ts",
  "lib/manifests/match-video-index.manifest.ts",
  "lib/offline/shell-routes.ts",
  "lib/media/hosted-video-cap.ts",
] as const;

describe("leftover student video-more chrome", () => {
  it("does not print leftover Match Video Index titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Match Video Index/);
    }
    const client = readFileSync(
      join(WEB, "app/match-video-index/match-video-index-client.tsx"),
      "utf8",
    );
    expect(client).toMatch(/title="Video index"/);
    expect(client).toMatch(/feature="Video index"/);
    expect(client).not.toMatch(/title="Loading/);
    const related = readFileSync(
      join(WEB, "lib/match-video-index/match-video-index-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Opening Video index/);
    expect(related).toMatch(/Retry Video index/);
    expect(related).toMatch(/label: "Match notes"/);
    expect(related).toMatch(/label: "Open Match notes"/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    const page = readFileSync(join(WEB, "app/match-video-index/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Video index"/);
    const route = readFileSync(join(WEB, "app/api/match-video-index/route.ts"), "utf8");
    expect(route).toMatch(/Could not load Video index/);
    expect(route).toMatch(/Video index request failed/);
    expect(route).toMatch(/Choose your team/);
    const manifest = readFileSync(
      join(WEB, "lib/manifests/match-video-index.manifest.ts"),
      "utf8",
    );
    expect(manifest).toMatch(/title: "Video index"/);
    const cap = readFileSync(join(WEB, "lib/media/hosted-video-cap.ts"), "utf8");
    expect(cap).toMatch(/YouTube link in the Video index/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
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
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-strategy-cards"\)\) return "Match cards"/,
    );
  });
});
