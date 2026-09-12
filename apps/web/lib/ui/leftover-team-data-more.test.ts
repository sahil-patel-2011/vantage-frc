import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Team Data titles after leftover-home-more. Student
 * titles say Team data. leftover-team-data Connect TBA / TBA Read API /
 * Save a TBA key stay. leftover-home-more Home screens / Season impact,
 * leftover-delta Match delta, leftover-video-more Video index,
 * leftover-match-more Pick clock / Match notes / Counter-book / Retro,
 * leftover-tool-more Tool checkout, leftover-build-more Parts relay /
 * Subsystem sign-off, leftover-fmea Failure log, leftover-pick Choose
 * your team, leftover-invites Invites, leftover-visit-invites Visit
 * invites, leftover-community-impact Impact, leftover-hub-mismatch
 * Impact essay, leftover-event-day-more Event day, leftover-ops-more
 * Skills / Risk register / Burndown stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/team/data/team-data-client.tsx",
  "app/team/data/page.tsx",
  "lib/team-data/team-data-related.ts",
  "lib/offline/shell-routes.ts",
  "lib/strategy/pick-clock-related.ts",
  "lib/match-delta-watcher/match-delta-watcher-related.ts",
] as const;

describe("leftover student team-data-more chrome", () => {
  it("does not print leftover Team Data titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Team Data/);
    }
    const client = readFileSync(join(WEB, "app/team/data/team-data-client.tsx"), "utf8");
    expect(client).toMatch(/<h1>Team data<\/h1>/);
    expect(client).toMatch(/feature="Team data"/);
    expect(client).toMatch(/Opening Team data/);
    expect(client).not.toMatch(/title="Loading/);
    expect(client).toMatch(/Connect TBA/);
    expect(client).toMatch(/TBA Read API/);
    expect(client).toMatch(/Event day/);
    expect(client).toMatch(/Choose your team/);
    const related = readFileSync(join(WEB, "lib/team-data/team-data-related.ts"), "utf8");
    expect(related).toMatch(/Choose your team/);
    expect(related).toMatch(/Open Event day/);
    expect(related).toMatch(/Save a TBA key/);
    expect(related).toMatch(/Retry Team data/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    expect(related).not.toMatch(/Event Day/);
    const page = readFileSync(join(WEB, "app/team/data/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Team data"/);
    expect(page).toMatch(/<h1>Team data<\/h1>/);
    const clock = readFileSync(join(WEB, "lib/strategy/pick-clock-related.ts"), "utf8");
    expect(clock).toMatch(/Sync Team data/);
    expect(clock).toMatch(/Opening Pick clock/);
    expect(clock).toMatch(/Choose your team/);
    const delta = readFileSync(
      join(WEB, "lib/match-delta-watcher/match-delta-watcher-related.ts"),
      "utf8",
    );
    expect(delta).toMatch(/Sync Team data/);
    expect(delta).toMatch(/Opening Match delta/);
    expect(delta).toMatch(/Choose your team/);
    expect(delta).toMatch(/Event day/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/team\/data"\)\) return "Team data"/);
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
