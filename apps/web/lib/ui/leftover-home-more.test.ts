import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Home Screens / Season Impact titles after leftover-delta.
 * Hub labels stay Home and Showcase. leftover-delta Match delta,
 * leftover-video-more Video index, leftover-match-more Pick clock / Match
 * notes / Counter-book / Retro, leftover-tool-more Tool checkout,
 * leftover-build-more Parts relay / Subsystem sign-off, leftover-fmea
 * Failure log, leftover-pick Choose your team, leftover-invites Invites,
 * leftover-visit-invites Visit invites, leftover-community-impact Impact,
 * leftover-event-day-more Event day, leftover-ops-more Skills / Risk
 * register / Burndown stay. leftover-hub-mismatch Impact essay stays.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/dashboard/dashboard-boards-modal.tsx",
  "app/showcase/present/presentation-client.tsx",
  "app/showcase/showcase-client.tsx",
  "app/api/showcase/route.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student home-more chrome", () => {
  it("does not print leftover Home Screens / Season Impact titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Home Screens/);
      expect(src, rel).not.toMatch(/Season Impact/);
    }
    const boards = readFileSync(
      join(WEB, "app/dashboard/dashboard-boards-modal.tsx"),
      "utf8",
    );
    expect(boards).toMatch(/title="Home screens"/);
    const present = readFileSync(
      join(WEB, "app/showcase/present/presentation-client.tsx"),
      "utf8",
    );
    expect(present).toMatch(/title="Season impact"/);
    expect(present).toMatch(/Choose your team/);
    expect(present).not.toMatch(/VANTAGE \//);
    expect(present).not.toMatch(/\bPick a team\b/);
    expect(present).not.toMatch(/Join or pick a team/);
    const showcase = readFileSync(join(WEB, "app/showcase/showcase-client.tsx"), "utf8");
    expect(showcase).toMatch(/title: "Season impact"/);
    const route = readFileSync(join(WEB, "app/api/showcase/route.ts"), "utf8");
    expect(route).toMatch(/Season impact/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/dashboard"\)\) return "Home"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/showcase"\)\) return "Showcase"/);
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
