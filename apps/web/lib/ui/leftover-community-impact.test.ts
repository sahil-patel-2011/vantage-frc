import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Community Impact titles after leftover-event-day-more.
 * Hub label stays Impact. leftover-hub-strips Open Impact essay /
 * Open Media kit, leftover-hub-mismatch Impact essay, leftover-judge-sim
 * Judge pitch, leftover-business-more Eligibility, leftover-people-more
 * Matching gifts, leftover-goals-kit Season report, leftover-kit Reports,
 * leftover-event-day-more Event day, leftover-ops-more Skills / Risk
 * register / Burndown, leftover-pick-before Choose your team,
 * leftover-join-or-pick Choose your team, leftover-help-workspace
 * Connect TBA stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/impact/impact-client.tsx",
  "app/impact/page.tsx",
  "lib/offline/shell-routes.ts",
  "lib/duty-roster-shared.ts",
  "lib/help/articles.ts",
  "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts",
  "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts",
  "lib/matching-gift-finder/matching-gift-finder-related.ts",
  "lib/business/business-related.ts",
  "lib/season-report/season-report-related.ts",
  "lib/grant-report/grant-report-related.ts",
  "app/grant-report/grant-report-client.tsx",
  "lib/media-kit/media-kit-related.ts",
  "lib/media/media-related.ts",
  "app/media/media-panels.tsx",
  "lib/outreach-calendar/outreach-calendar-related.ts",
  "app/outreach-calendar/outreach-calendar-client.tsx",
  "lib/judge-sim/judge-sim-related.ts",
  "lib/judge-sim/compute-judge-sim.ts",
  "app/judge-sim/judge-sim-client.tsx",
  "lib/impact-essay/impact-essay-related.ts",
  "lib/impact-essay/compute-impact-essay.ts",
  "app/impact-essay/impact-essay-client.tsx",
  "app/api/impact/route.ts",
  "app/notebook/notebook-client.tsx",
  "lib/business/impact-next-actions.ts",
  "lib/search/unified-search.ts",
  "app/team/grants/grants-client.tsx",
  "lib/grant-assist/load-evidence.ts",
  "lib/impact-essay/index.ts",
  "lib/outreach/complete-to-impact.ts",
  "app/business/business-panels.tsx",
  "lib/business-portal.ts",
] as const;

describe("leftover student community-impact chrome", () => {
  it("does not print leftover Community Impact student titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Community Impact/);
      expect(src, rel).not.toMatch(/Open Community Impact/);
      expect(src, rel).not.toMatch(/Log Community Impact/);
      expect(src, rel).not.toMatch(/Cross-check Community Impact/);
    }
    const client = readFileSync(join(WEB, "app/impact/impact-client.tsx"), "utf8");
    expect(client).toMatch(/title="Impact"/);
    expect(client).toMatch(/feature="Impact"/);
    expect(client).toMatch(/Opening Impact/);
    expect(client).not.toMatch(/title="Loading/);
    const related = readFileSync(
      join(WEB, "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Opening Eligibility/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).toMatch(/Open Impact/);
    const gifts = readFileSync(
      join(WEB, "lib/matching-gift-finder/matching-gift-finder-related.ts"),
      "utf8",
    );
    expect(gifts).toMatch(/Matching gifts/);
    expect(gifts).toMatch(/Open Renewal ROI/);
    const essay = readFileSync(join(WEB, "app/impact-essay/impact-essay-client.tsx"), "utf8");
    expect(essay).toMatch(/title="Impact essay"/);
    expect(essay).toMatch(/feature="Impact essay"/);
    const essayRelated = readFileSync(
      join(WEB, "lib/impact-essay/impact-essay-related.ts"),
      "utf8",
    );
    expect(essayRelated).toMatch(/Opening Impact essay/);
    expect(essayRelated).toMatch(/Choose your team/);
    const judge = readFileSync(join(WEB, "lib/judge-sim/judge-sim-related.ts"), "utf8");
    expect(judge).toMatch(/Open Impact essay/);
    const judgeClient = readFileSync(join(WEB, "app/judge-sim/judge-sim-client.tsx"), "utf8");
    expect(judgeClient).toMatch(/feature="Judge pitch"/);
    const media = readFileSync(join(WEB, "lib/media/media-related.ts"), "utf8");
    expect(media).toMatch(/Open Media kit/);
    const mediaKit = readFileSync(join(WEB, "lib/media-kit/media-kit-related.ts"), "utf8");
    expect(mediaKit).toMatch(/Opening Media kit/);
    expect(mediaKit).toMatch(/Choose your team/);
    const report = readFileSync(join(WEB, "lib/season-report/season-report-related.ts"), "utf8");
    expect(report).toMatch(/Opening Season report/);
    expect(report).toMatch(/Choose your team/);
    const grants = readFileSync(join(WEB, "lib/grant-report/grant-report-related.ts"), "utf8");
    expect(grants).toMatch(/Opening Reports/);
    expect(grants).toMatch(/Choose your team/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/Connect TBA/);
    expect(articles).toMatch(/Choose your team/);
    expect(articles).toMatch(/Alliance desk/);
    expect(articles).toMatch(/Open Event day/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact"\)\) return "Impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact-essay"\)\) return "Impact essay"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
  });
});
