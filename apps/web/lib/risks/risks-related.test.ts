import { describe, expect, it } from "vitest";
import {
  RISKS_TEAM_RELATED_INCLUDE,
  formatLikelihoodImpact,
  formatRiskRegisterMeta,
  formatRiskScoreDisplay,
  risksNextActions,
  risksRelatedLinks,
} from "./risks-related";

describe("risks-related Soft-UI helpers", () => {
  it("builds FMEA / Knowledge cross-links", () => {
    const links = risksRelatedLinks("org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "subsystems")?.href).toBe("/subsystems?orgId=org-1");
  });

  it("excludes active and respects include", () => {
    const links = risksRelatedLinks("org-1", {
      active: "batteries",
      include: ["fmea", "knowledge"],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "knowledge"]);
  });

  it("never uses DEMO labels or score placeholders", () => {
    const links = risksRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    const emptyActions = risksNextActions({
      orgId: "org-1",
      riskCount: 0,
      activeCount: 0,
      overdueCount: 0,
      highestScore: 0,
    });
    expect(emptyActions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(emptyActions[0]?.id).toBe("add-first");
    expect(emptyActions.some((a) => a.id === "fmea")).toBe(true);
    expect(emptyActions.some((a) => a.id === "knowledge")).toBe(true);
  });

  it("hides numeric scores when no active risks are logged", () => {
    expect(formatRiskScoreDisplay(0, false)).toBe("—");
    expect(formatRiskScoreDisplay(20, true)).toBe("20");
    expect(formatLikelihoodImpact({ likelihood: 4, impact: 5 })).toBe("L4 × I5");
  });

  it("formats register meta from scored evaluations only", () => {
    const meta = formatRiskRegisterMeta({
      score: 20,
      level: "critical",
      risk: {
        id: "r1",
        title: "Climber slip",
        category: "technical",
        likelihood: 4,
        impact: 5,
        status: "open",
        mitigation: "Add ratchet",
        owner: "Build lead",
        dueOn: null,
        notes: null,
        seasonYear: 2026,
      },
    });
    expect(meta).toBe("technical · L4 × I5 · score 20 · Build lead");
    expect(meta).not.toMatch(/demo/i);
  });

  it("uses focused Team related includes without DEMO labels", () => {
    expect(RISKS_TEAM_RELATED_INCLUDE).toContain("knowledge");
    expect(RISKS_TEAM_RELATED_INCLUDE).toContain("fmea");
    expect(RISKS_TEAM_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(
      risksNextActions({
        riskCount: 0,
        activeCount: 0,
        overdueCount: 0,
        highestScore: 0,
      }).map((a) => a.id),
    ).toEqual(["workspace"]);
  });

  it("prioritizes overdue mitigations from real scores", () => {
    const actions = risksNextActions({
      orgId: "org-1",
      riskCount: 2,
      activeCount: 2,
      overdueCount: 1,
      highestScore: 20,
      topTitle: "Climber slip",
    });
    expect(actions[0]?.id).toBe("overdue");
    expect(actions[0]?.detail).toContain("20");
    expect(actions[0]?.detail).not.toMatch(/demo/i);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
  });
});
