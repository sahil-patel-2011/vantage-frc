/**
 * Source lock for remaining Impact / community student boards: Community
 * Impact, Awards, Impact Essay, Outreach calendar, Judge-Pitch, Award
 * Tracker, and Mock Judging. Funding hub files (Sponsors / Grants / Budget)
 * are owned by other agents and are not rewritten here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { awardsNextActions } from "../business/awards-next-actions";
import { AWARDS_RELATED_INCLUDE, IMPACT_RELATED_INCLUDE, businessRelatedLinks } from "../business/business-related";
import { impactNextActions } from "../business/impact-next-actions";
import { awardTrackerShellCopy } from "../award-tracker/award-tracker-related";
import { impactEssayShellCopy } from "../impact-essay/impact-essay-related";
import { judgeSimShellCopy } from "../judge-sim/judge-sim-related";
import { outreachCalendarShellCopy } from "../outreach-calendar/outreach-calendar-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const SLICE = [
  "app/impact/impact-client.tsx",
  "app/team/awards/awards-client.tsx",
  "app/team/awards/page.tsx",
  "app/impact-essay/impact-essay-client.tsx",
  "app/outreach-calendar/outreach-calendar-client.tsx",
  "app/judge-sim/judge-sim-client.tsx",
  "app/award-tracker/award-tracker-client.tsx",
  "app/mock-judging/mock-judging-client.tsx",
  "lib/impact-essay/impact-essay-related.ts",
  "lib/judge-sim/judge-sim-related.ts",
  "lib/outreach-calendar/outreach-calendar-related.ts",
  "lib/award-tracker/award-tracker-related.ts",
  "lib/business/impact-next-actions.ts",
  "lib/business/awards-next-actions.ts",
  "lib/business/business-related.ts",
  "lib/impact/compute-impact.ts",
  "lib/mock-judging/compute-mock-judging.ts",
] as const;

describe("Impact / community remaining student chrome", () => {
  it("does not print Setup required, Pick a team, Stripe, or OAuth on this slice", () => {
    for (const rel of SLICE) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Team needed/);
      expect(src, rel).not.toMatch(/\bPick a team\b/);
      expect(src, rel).not.toMatch(/\bStripe\b/);
      expect(src, rel).not.toMatch(/\bOAuth\b/);
    }
  });

  it("setup badges stay Needs setup", () => {
    expect(impactEssayShellCopy("setup").badge).toBe("Needs setup");
    expect(judgeSimShellCopy("setup").badge).toBe("Needs setup");
    expect(outreachCalendarShellCopy("setup").badge).toBe("Needs setup");
    expect(awardTrackerShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(impactEssayShellCopy("setup").description);
    expectPlainCopy(judgeSimShellCopy("empty").description);
    const awards = readFileSync(join(WEB, "app/team/awards/awards-client.tsx"), "utf8");
    expect(awards).toMatch(/badge="Needs setup"/);
    expect(awards).toMatch(/fetchActiveOrgId/);
  });

  it("Community Impact related strip is Awards · Outreach · Writer, not the funding hub", () => {
    expect([...IMPACT_RELATED_INCLUDE]).toEqual(["awards", "evidence", "writer"]);
    const links = businessRelatedLinks("org-1", {
      active: "impact",
      include: [...IMPACT_RELATED_INCLUDE],
    });
    expect(links.map((link) => link.label)).toEqual(["Outreach", "Awards", "Writer"]);
    expect([...AWARDS_RELATED_INCLUDE]).toEqual(["impact", "evidence", "writer"]);
  });

  it("empty Community Impact and Awards keep one next action and skip grants/sponsors", () => {
    const emptyImpact = impactNextActions({ orgId: "org-1", activityCount: 0 });
    expect(emptyImpact).toHaveLength(1);
    expect(emptyImpact[0]?.id).toBe("first-activity");
    expect(emptyImpact.map((a) => a.id)).not.toContain("grants");
    expect(emptyImpact.map((a) => a.id)).not.toContain("sponsors");

    const emptyAwards = awardsNextActions({ orgId: "org-1", submissionCount: 0 });
    expect(emptyAwards).toHaveLength(1);
    expect(emptyAwards[0]?.id).toBe("start");
    expect(emptyAwards.map((a) => a.id)).not.toContain("grants");
    expect(emptyAwards.map((a) => a.id)).not.toContain("sponsors");
  });

  it("live Community Impact hides readiness and next-actions until activities exist", () => {
    const impact = readFileSync(join(WEB, "app/impact/impact-client.tsx"), "utf8");
    expect(impact).toMatch(/view\.summary\.totalEvents > 0 \? <ImpactNextActions/);
    expect(impact).toMatch(/view\.summary\.totalEvents > 0 \? <ReadinessPanel/);
    expect(impact).toMatch(/Hours, people reached, and readiness stay blank until you log real outreach/);

    const mock = readFileSync(join(WEB, "app/mock-judging/mock-judging-client.tsx"), "utf8");
    expect(mock).toMatch(/view\.readiness\.totalSessions > 0 \? <MockJudgingNextActions/);
    expect(mock).toMatch(/view\.readiness\.totalSessions > 0 \? <ReadinessPanel/);
  });
});
