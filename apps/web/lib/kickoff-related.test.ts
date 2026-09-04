import { describe, expect, it } from "vitest";
import {
  KICKOFF_BUILD_RELATED_INCLUDE,
  kickoffNextActions,
  kickoffPipelineLinks,
  shouldShowKickoffSummaryTiles,
} from "./kickoff-related";

describe("kickoff-related Soft-UI helpers", () => {
  it("focuses Build related include on CAD / FMEA / prototypes / competition", () => {
    expect(KICKOFF_BUILD_RELATED_INCLUDE).toEqual(["cad", "fmea", "prototype", "competition"]);
    expect(KICKOFF_BUILD_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("points empty kickoff at manual entry, Strategy seeds, and CAD — never DEMO rules", () => {
    const actions = kickoffNextActions({
      orgId: "org-1",
      seasonYear: 2027,
      hasIntelligence: false,
      actionCount: 0,
      priorityCount: 0,
      openRuleCount: 0,
    });
    expect(actions[0]?.id).toBe("upload-materials");
    expect(actions.some((a) => a.id === "strategy-seeds")).toBe(true);
    expect(actions.some((a) => a.id === "cad-brief")).toBe(true);
    expect(actions.find((a) => a.id === "upload-materials")?.detail).toMatch(/nothing invents DEMO game rules/i);
    expect(actions.every((a) => !/DEMO\s+\d|fabricated EPA|fake OPR|demo score/i.test(`${a.label} ${a.detail}`))).toBe(
      true,
    );
    expect(actions.find((a) => a.id === "strategy-seeds")?.href).toContain("tab=strategy");
    expect(actions.find((a) => a.id === "cad-brief")?.href).toContain("tab=cad");
  });

  it("asks for workspace when org is missing", () => {
    const actions = kickoffNextActions({
      seasonYear: 2027,
      hasIntelligence: false,
      actionCount: 0,
      priorityCount: 0,
      openRuleCount: 0,
    });
    expect(actions).toEqual([
      expect.objectContaining({ id: "workspace", href: "/workspace", primary: true }),
    ]);
  });

  it("promotes Strategy review + CAD brief when intelligence exists", () => {
    const actions = kickoffNextActions({
      orgId: "org-1",
      seasonYear: 2027,
      hasIntelligence: true,
      actionCount: 4,
      priorityCount: 3,
      openRuleCount: 2,
      cadJobId: "job-1",
    });
    expect(actions[0]?.id).toBe("review-strategy");
    expect(actions.some((a) => a.id === "open-cad-brief")).toBe(true);
    expect(actions.some((a) => a.id === "rules-qa")).toBe(true);
    expect(actions.find((a) => a.id === "rules-qa")?.detail).toMatch(/never invent DEMO rulings/i);
  });

  it("builds pipeline links to Strategy seeds and CAD", () => {
    const links = kickoffPipelineLinks({ orgId: "org-1", cadJobId: "job-9" });
    expect(links.find((l) => l.id === "strategy-seeds")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "cad-brief")?.label).toBe("Open CAD brief");
    expect(links.find((l) => l.id === "cad-brief")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("offers the 5-hour Pi analysis only to team 6925", () => {
    const allowed = kickoffNextActions({
      orgId: "org-1",
      seasonYear: 2027,
      hasIntelligence: false,
      actionCount: 0,
      priorityCount: 0,
      openRuleCount: 0,
      teamNumber: 6925,
    });
    expect(allowed.some((action) => action.id === "deep-game-analysis")).toBe(true);
    const denied = kickoffNextActions({
      orgId: "org-1",
      seasonYear: 2027,
      hasIntelligence: false,
      actionCount: 0,
      priorityCount: 0,
      openRuleCount: 0,
      teamNumber: 254,
    });
    expect(denied.some((action) => action.id === "deep-game-analysis")).toBe(false);
  });

  it("hides zeroed summary tiles until real rows exist", () => {
    expect(
      shouldShowKickoffSummaryTiles({ actions: 0, bestAction: null, committed: 0, openQuestions: 0 }),
    ).toBe(false);
    expect(
      shouldShowKickoffSummaryTiles({ actions: 2, bestAction: "Climb", committed: 0, openQuestions: 0 }),
    ).toBe(true);
  });
});
