import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Pick Clock / Match Note Timeline / Opponent
 * Counter-book / Team Retrospective titles after leftover-tool-more.
 * Hub labels stay Pick clock, Match notes, Counter-book, and Retro.
 * leftover-fmea Failure log, leftover-fmea-strips no Open FMEA,
 * leftover-pick Choose your team, leftover-team-data Sync Team data,
 * leftover-invites Invites, leftover-visit-invites Visit invites,
 * leftover-community-impact Impact, leftover-event-day-more Event day,
 * leftover-ops-more Skills / Risk register / Burndown,
 * leftover-build-more Parts relay / Subsystem sign-off,
 * leftover-tool-more Tool checkout stay. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/pick-clock/pick-clock-client.tsx",
  "app/pick-clock/page.tsx",
  "lib/strategy/pick-clock-related.ts",
  "app/match-notes-timeline/match-notes-timeline-client.tsx",
  "app/match-notes-timeline/page.tsx",
  "lib/match-notes-timeline/match-notes-timeline-related.ts",
  "lib/manifests/match-notes-timeline.manifest.ts",
  "app/counter-book/counter-book-client.tsx",
  "app/counter-book/page.tsx",
  "lib/counter-book/counter-book-related.ts",
  "lib/manifests/counter-book.manifest.ts",
  "app/retro/retro-client.tsx",
  "app/retro/page.tsx",
  "lib/retro/retro-related.ts",
  "lib/manifests/retro.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student match-more chrome", () => {
  it("does not print leftover Pick Clock / Match Note Timeline titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Pick Clock/);
      expect(src, rel).not.toMatch(/Match Note Timeline/);
      expect(src, rel).not.toMatch(/Opponent Counter-book/);
      expect(src, rel).not.toMatch(/Team Retrospective/);
    }
    const clock = readFileSync(join(WEB, "app/pick-clock/pick-clock-client.tsx"), "utf8");
    expect(clock).toMatch(/title="Pick clock"/);
    expect(clock).toMatch(/feature="Pick clock"/);
    expect(clock).not.toMatch(/title="Loading/);
    const notes = readFileSync(
      join(WEB, "app/match-notes-timeline/match-notes-timeline-client.tsx"),
      "utf8",
    );
    expect(notes).toMatch(/title="Match notes"/);
    expect(notes).toMatch(/feature="Match notes"/);
    expect(notes).not.toMatch(/title="Loading/);
    const counter = readFileSync(join(WEB, "app/counter-book/counter-book-client.tsx"), "utf8");
    expect(counter).toMatch(/title="Counter-book"/);
    expect(counter).toMatch(/feature="Counter-book"/);
    expect(counter).not.toMatch(/title="Loading/);
    const retro = readFileSync(join(WEB, "app/retro/retro-client.tsx"), "utf8");
    expect(retro).toMatch(/title="Retro"/);
    expect(retro).toMatch(/feature="Retro"/);
    expect(retro).not.toMatch(/title="Loading/);
    const clockRelated = readFileSync(join(WEB, "lib/strategy/pick-clock-related.ts"), "utf8");
    expect(clockRelated).toMatch(/Opening Pick clock/);
    expect(clockRelated).not.toMatch(/title="Loading/);
    expect(clockRelated).toMatch(/Choose your team/);
    expect(clockRelated).toMatch(/Sync Team data/);
    expect(clockRelated).not.toMatch(/\bPick a team\b/);
    const notesRelated = readFileSync(
      join(WEB, "lib/match-notes-timeline/match-notes-timeline-related.ts"),
      "utf8",
    );
    expect(notesRelated).toMatch(/Opening Match notes/);
    expect(notesRelated).not.toMatch(/title="Loading/);
    expect(notesRelated).toMatch(/Choose your team/);
    expect(notesRelated).not.toMatch(/\bPick a team\b/);
    const counterRelated = readFileSync(
      join(WEB, "lib/counter-book/counter-book-related.ts"),
      "utf8",
    );
    expect(counterRelated).toMatch(/Opening Counter-book/);
    expect(counterRelated).not.toMatch(/title="Loading/);
    expect(counterRelated).toMatch(/Choose your team/);
    const retroRelated = readFileSync(join(WEB, "lib/retro/retro-related.ts"), "utf8");
    expect(retroRelated).toMatch(/Opening Retro/);
    expect(retroRelated).not.toMatch(/title="Loading/);
    expect(retroRelated).toMatch(/Choose your team/);
    expect(retroRelated).toMatch(/Failure log/);
    expect(retroRelated).toMatch(/Open Failure log/);
    expect(retroRelated).not.toMatch(/Open FMEA/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/pick-clock"\)\) return "Pick clock"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-notes-timeline"\)\) return "Match notes"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/counter-book"\)\) return "Counter-book"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/retro"\)\) return "Retro"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/tool-checkout"\)\) return "Tool checkout"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/parts-relay"\)\) return "Parts relay"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/subsystem-signoff"\)\) return "Subsystem sign-off"/,
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
  });
});
