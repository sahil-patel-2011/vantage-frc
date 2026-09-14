import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Event day titles after leftover-ops-more. Hub label stays
 * Event day. leftover-event-day-titles Districts family, leftover-ops-more
 * Skills / Risk register / Burndown, leftover-fmea Failure log, leftover-lxi
 * How likely / How bad, leftover-join-or-pick Choose your team,
 * leftover-pick-before Choose your team, leftover-help-workspace Connect TBA,
 * leftover-epa studentRatingLabel, leftover-team-data Connect TBA / TBA Read
 * API, leftover-code-coach Code, leftover-llms Failure log,
 * leftover-business-more Eligibility, leftover-media Photos & video,
 * leftover-safety Safety incidents, leftover-scout-more Accuracy family stay.
 * leftover-community-impact Impact stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/command/command-client.tsx",
  "app/command/command-chrome.tsx",
  "app/command/command-ready-view.tsx",
  "app/command/page.tsx",
  "lib/command/load-command.ts",
  "lib/command/event-day-related.ts",
  "lib/command/event-day-actions.ts",
  "lib/offline/shell-routes.ts",
  "lib/my-day-related.ts",
  "app/my-day/my-day-client.tsx",
  "lib/team-data/team-data-related.ts",
  "app/team/data/team-data-client.tsx",
  "app/team/data/page.tsx",
  "lib/display/display-related.ts",
  "app/display/setup-client.tsx",
  "app/display/page.tsx",
  "lib/pit/pit-related.ts",
  "app/pit/page.tsx",
  "lib/logistics/logistics-related.ts",
  "lib/schedule/schedule-related.ts",
  "lib/visit-invites/visit-related.ts",
  "lib/match-checklist/match-checklist-related.ts",
  "lib/match-checklist/compute-match-checklist.ts",
  "lib/strategy/strategy-related.ts",
  "lib/strategy/competition-related.ts",
  "app/strategy/strategy-live-panel.tsx",
  "lib/scouting/form-builder.ts",
  "lib/scouting/scouting-related.ts",
  "lib/scouting/lineup-related.ts",
  "app/scouting/scouting-trust-panel.tsx",
  "lib/scout-coverage-live/scout-coverage-live-related.ts",
  "lib/scout-disagreements/scout-disagreements-related.ts",
  "lib/scout-crossval/scout-crossval-related.ts",
  "lib/scout-data-impact/scout-data-impact-related.ts",
  "lib/scout-accuracy/scout-accuracy-related.ts",
  "lib/overnight-intel/overnight-intel-related.ts",
  "lib/home-workflows.ts",
  "lib/duty-roster-shared.ts",
  "hooks/use-venue-shortcuts.tsx",
  "app/checklist-library/checklist-library-client.tsx",
  "lib/chemistry/load-chemistry.ts",
  "lib/role-onboarding/tracks.ts",
  "lib/subteam-calendar.ts",
  "app/api/command/route.ts",
  "app/api/chemistry/route.ts",
  "app/api/scouting/reconcile/route.ts",
  "lib/match-delta-watcher/match-delta-watcher-related.ts",
  "lib/my-day.ts",
  "lib/support-tickets/support-related.ts",
  "components/seo/structured-data.tsx",
  "app/pricing/pricing-catalog.tsx",
  "app/pricing/page.tsx",
  "lib/help/articles.ts",
  "app/llms-full.txt/route.ts",
] as const;

describe("leftover student event-day-more chrome", () => {
  it("does not print leftover Event Day student titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Event Day/);
    }
    const chrome = readFileSync(join(WEB, "app/command/command-chrome.tsx"), "utf8");
    expect(chrome).toMatch(/title="Event day"/);
    expect(chrome).toMatch(/Opening Event day/);
    expect(chrome).not.toMatch(/title="Loading/);
    expect(chrome).toMatch(/Choose your team/);
    const ready = readFileSync(join(WEB, "app/command/command-ready-view.tsx"), "utf8");
    expect(ready).toMatch(/feature="Event day"/);
    expect(ready).toMatch(/studentRatingLabel/);
    expect(ready).toMatch(/studentSourceLabel/);
    const related = readFileSync(join(WEB, "lib/command/event-day-related.ts"), "utf8");
    expect(related).toMatch(/Opening Event day/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    const load = readFileSync(join(WEB, "lib/command/load-command.ts"), "utf8");
    expect(load).toMatch(/Choose your team/);
    expect(load).not.toMatch(/Join or pick a team/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    const teamData = readFileSync(join(WEB, "app/team/data/team-data-client.tsx"), "utf8");
    expect(teamData).toMatch(/Connect TBA/);
    expect(teamData).toMatch(/TBA Read API/);
    const teamRelated = readFileSync(join(WEB, "lib/team-data/team-data-related.ts"), "utf8");
    expect(teamRelated).toMatch(/Save a TBA key/);
    expect(teamRelated).toMatch(/Open Event day/);
    expect(teamRelated).toMatch(/Choose your team/);
    expect(teamRelated).not.toMatch(/\bPick a team\b/);
    const llms = readFileSync(join(WEB, "app/llms-full.txt/route.ts"), "utf8");
    expect(llms).toMatch(/Failure log/);
    expect(llms).toMatch(/Connect Onshape/);
    expect(llms).not.toMatch(/Code Coach/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/match-strategy-cards"\)\) return "Match cards"/,
    );
  });
});
