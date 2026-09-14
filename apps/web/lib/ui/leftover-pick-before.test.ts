import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student "Pick a team before…" next-actions and Bugbot PAT / OAuth
 * after leftover-pick-a-team. "Pick a teammate" stays. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/code/code-bugbot-panel.tsx",
  "lib/code/code-related.ts",
  "lib/help/articles.ts",
  "lib/spare-forecast/spare-forecast-related.ts",
  "lib/failure-patterns/failure-patterns-related.ts",
  "lib/control-map/control-map-related.ts",
  "lib/vendor-lead-times/vendor-lead-times-related.ts",
  "lib/spare-robot-kit/spare-robot-kit-related.ts",
  "lib/tuning-autopilot/tuning-autopilot-related.ts",
  "lib/rule-impact/rule-impact-related.ts",
  "lib/match-copilot/match-copilot-related.ts",
  "lib/onboarding-buddy/onboarding-buddy-related.ts",
  "lib/match-notes-timeline/match-notes-timeline-related.ts",
  "lib/picklist-justifier/picklist-justifier-related.ts",
  "lib/opponent-watchlist/opponent-watchlist-related.ts",
  "lib/epa-trend-alerts/epa-trend-alerts-related.ts",
  "lib/sketch-to-brief/sketch-to-brief-related.ts",
  "lib/season-planning-workspace/season-planning-workspace-related.ts",
  "lib/season-report/season-report-related.ts",
  "lib/grant-eligibility-matcher/grant-eligibility-matcher-related.ts",
  "lib/vendors/vendors-related.ts",
  "lib/decisions/decisions-related.ts",
  "lib/code-deploy-log/code-deploy-log-related.ts",
  "lib/decision-search/decision-search-related.ts",
  "lib/counter-book/counter-book-related.ts",
  "lib/alliance-partner-brief/alliance-partner-brief-related.ts",
  "lib/account/account-related.ts",
  "lib/account/connections-related.ts",
  "lib/scouting-heat-signals/scouting-heat-signals-related.ts",
  "lib/scout-assisted-count/scout-assisted-count-related.ts",
  "lib/scout-field-budget/scout-field-budget-related.ts",
] as const;

describe("leftover student Pick a team before / PAT OAuth chrome", () => {
  it("does not tell the reader to Pick a team or link a PAT or OAuth app", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/\bPick a team\b/);
      expect(src, rel).not.toMatch(/PAT or OAuth/);
      expect(src, rel).not.toMatch(/OAuth app/);
      expect(src, rel).not.toMatch(/encrypted PAT/);
      expect(src, rel).not.toMatch(/Google OAuth env/);
    }
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).not.toMatch(/Notion OAuth/);
    expect(articles).not.toMatch(/setup-required/);
    const account = readFileSync(join(WEB, "lib/account/account-related.ts"), "utf8");
    expect(account).not.toMatch(/setup-required/);
    expect(account).toMatch(/ACCOUNT_EMAIL_COPY/);
    const bugbot = readFileSync(join(WEB, "app/code/code-bugbot-panel.tsx"), "utf8");
    expect(bugbot).toMatch(/connect GitHub under Invites/);
    const code = readFileSync(join(WEB, "lib/code/code-related.ts"), "utf8");
    expect(code).toMatch(/Connect GitHub/);
  });
});
