import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on surfaces that are not skip-list and not in
 * open PRs #2–#37. Audit, posture, exports, and knowledge history now say
 * “Choose your team” in the no-team header.
 */
const FILES = [
  "app/strategy/board/board-client.tsx",
  "app/strategy/draft/draft-client.tsx",
  "lib/strategy/draft-related.ts",
  "lib/strategy/pick-desk-related.ts",
  "lib/strategy/strategy-related.ts",
  "lib/strategy/pick-clock-related.ts",
  "app/team/team-admin-client.tsx",
  "app/help/help-article-client.tsx",
  "app/attendance/attendance-client.tsx",
] as const;

const NO_TEAM_HEADERS = [
  "app/team/knowledge/history/page.tsx",
  "app/team/posture/page.tsx",
  "app/team/security/exports/page.tsx",
  "app/team/audit/page.tsx",
  "app/team/security/page.tsx",
  "app/team/ai-runs/page.tsx",
] as const;

describe("no-team headers say Choose your team", () => {
  it("does not say pick the team first or choose your team first", () => {
    for (const rel of NO_TEAM_HEADERS) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).toMatch(/Choose your team/);
      expect(src, rel).not.toMatch(/pick the team first/i);
      expect(src, rel).not.toMatch(/choose your team first/i);
    }
  });
});

describe("leftover student org-bound / token chrome", () => {
  it("does not say org-bound, Permalink, token hard limits, or workspace members", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/org-bound/i);
      expect(src, rel).not.toMatch(/mentor token/i);
      expect(src, rel).not.toMatch(/>Permalink</);
      expect(src, rel).not.toMatch(/token hard limits/i);
      expect(src, rel).not.toMatch(/API-key powers/i);
      expect(src, rel).not.toMatch(/workspace members/i);
      expect(src, rel).not.toMatch(/GitHub OAuth failed/);
      expect(src, rel).not.toMatch(/Could not start GitHub OAuth/);
      expect(src, rel).not.toMatch(/team_event_metrics/);
      expect(src, rel).not.toMatch(/membership-bound/);
    }
  });
});
