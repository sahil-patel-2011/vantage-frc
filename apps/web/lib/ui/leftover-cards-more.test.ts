import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Match Strategy Cards / Strategy Cards titles after
 * leftover-team-data-more. Hub label stays Match cards. leftover-event-day-titles
 * Drive-team board, leftover-delta Match delta, leftover-strategy Pick list,
 * leftover-event-day-more Event day / Open Event day, leftover-team-data
 * Sync Team data, leftover-pick Choose your team, leftover-video-more Video
 * index, leftover-home-more Home / Showcase, leftover-match-more Pick clock /
 * Match notes / Counter-book / Retro, leftover-tool-more Tool checkout,
 * leftover-build-more Parts relay / Subsystem sign-off, leftover-fmea Failure
 * log, leftover-invites Invites, leftover-visit-invites Visit invites,
 * leftover-community-impact Impact, leftover-ops-more Skills / Risk register /
 * Burndown stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/match-strategy-cards/match-strategy-cards-client.tsx",
  "app/match-strategy-cards/page.tsx",
  "lib/match-strategy-cards/match-strategy-cards-related.ts",
  "app/api/match-strategy-cards/route.ts",
  "lib/manifests/match-strategy-cards.manifest.ts",
  "lib/offline/shell-routes.ts",
  "lib/drive-team-signals/drive-team-signals-related.ts",
  "lib/match-delta-watcher/match-delta-watcher-related.ts",
] as const;

describe("leftover student cards-more chrome", () => {
  it("does not print leftover Match Strategy Cards titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Match Strategy Cards/);
      expect(src, rel).not.toMatch(/Strategy Cards/);
      expect(src, rel).not.toMatch(/Match strategy cards/);
      expect(src, rel).not.toMatch(/Open Strategy Cards/);
    }
    const client = readFileSync(
      join(WEB, "app/match-strategy-cards/match-strategy-cards-client.tsx"),
      "utf8",
    );
    expect(client).toMatch(/title="Match cards"/);
    expect(client).toMatch(/feature="Match cards"/);
    expect(client).toMatch(/Opening Match cards/);
    expect(client).not.toMatch(/title="Loading/);
    const related = readFileSync(
      join(WEB, "lib/match-strategy-cards/match-strategy-cards-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Opening Match cards/);
    expect(related).toMatch(/Retry Match cards/);
    expect(related).toMatch(/Choose your team/);
    expect(related).toMatch(/Sync Team data/);
    expect(related).toMatch(/Open Event day/);
    expect(related).toMatch(/label: "Defense"/);
    expect(related).toMatch(/Open Defense/);
    expect(related).toMatch(/label: "Drive-team board"/);
    expect(related).toMatch(/Open Drive-team board/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    expect(related).not.toMatch(/Event Day/);
    const drive = readFileSync(
      join(WEB, "lib/drive-team-signals/drive-team-signals-related.ts"),
      "utf8",
    );
    expect(drive).toMatch(/label: "Match cards"/);
    expect(drive).toMatch(/Open Match cards/);
    expect(drive).toMatch(/Drive-team board/);
    expect(drive).toMatch(/Open Briefing/);
    expect(drive).toMatch(/Open Match checklist/);
    expect(drive).not.toMatch(/Drive-Team Signals/);
    expect(drive).not.toMatch(/Drive-team signals/);
    expect(drive).not.toMatch(/Match Copilot/);
    const delta = readFileSync(
      join(WEB, "lib/match-delta-watcher/match-delta-watcher-related.ts"),
      "utf8",
    );
    expect(delta).toMatch(/Opening Match delta/);
    expect(delta).toMatch(/Retry Match delta/);
    expect(delta).toMatch(/Choose your team/);
    expect(delta).toMatch(/Sync Team data/);
    expect(delta).toMatch(/label: "Match cards"/);
    expect(delta).toMatch(/label: "Pick list"/);
    expect(delta).toMatch(/Open Pick list/);
    expect(delta).toMatch(/label: "Event day"/);
    expect(delta).toMatch(/Open Event day/);
    expect(delta).not.toMatch(/Event Day/);
    expect(delta).not.toMatch(/\bPick a team\b/);
    expect(delta).not.toMatch(/Join or pick a team/);
    const page = readFileSync(join(WEB, "app/match-strategy-cards/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Match cards"/);
    const route = readFileSync(join(WEB, "app/api/match-strategy-cards/route.ts"), "utf8");
    expect(route).toMatch(/Could not load Match cards/);
    expect(route).toMatch(/Match cards request failed/);
    expect(route).toMatch(/Choose your team/);
    const manifest = readFileSync(
      join(WEB, "lib/manifests/match-strategy-cards.manifest.ts"),
      "utf8",
    );
    expect(manifest).toMatch(/title: "Match cards"/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-strategy-cards"\)\) return "Match cards"/,
    );
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
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/drive-team-signals"\)\) return "Drive-team board"/,
    );
  });
});
