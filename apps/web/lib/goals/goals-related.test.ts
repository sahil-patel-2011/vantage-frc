import { describe, expect, it } from "vitest";
import {
  GOALS_TEAM_RELATED_INCLUDE,
  formatGoalsAchievedDisplay,
  formatGoalsProgressDisplay,
  goalsNextActions,
  goalsRelatedLinks,
} from "./goals-related";

describe("goals-related Soft-UI helpers", () => {
  it("builds Todos / Practice / Team hub cross-links", () => {
    const links = goalsRelatedLinks("org-1");
    expect(links.find((l) => l.id === "todos")?.href).toBe("/todos?orgId=org-1");
    expect(links.find((l) => l.id === "practice")?.href).toBe("/practice?orgId=org-1");
    expect(links.find((l) => l.id === "team")?.href).toBe("/team?orgId=org-1");
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
  });

  it("excludes active and respects include", () => {
    const links = goalsRelatedLinks("org-1", {
      active: "team",
      include: ["todos", "practice"],
    });
    expect(links.map((l) => l.id)).toEqual(["todos", "practice"]);
  });

  it("never uses DEMO labels or progress placeholders", () => {
    const links = goalsRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    const emptyActions = goalsNextActions({
      orgId: "org-1",
      goalCount: 0,
      achieved: 0,
      needsAttention: 0,
    });
    expect(emptyActions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(emptyActions[0]?.id).toBe("add-first");
    expect(emptyActions.some((a) => a.id === "todos")).toBe(true);
    expect(emptyActions.some((a) => a.id === "practice")).toBe(true);
    expect(emptyActions.some((a) => a.id === "team")).toBe(true);
  });

  it("hides progress % when no goals are logged", () => {
    expect(formatGoalsProgressDisplay(0, 0)).toBe("—");
    expect(formatGoalsProgressDisplay(0.42, 3)).toBe("42%");
    expect(formatGoalsAchievedDisplay(0, 0)).toBe("—");
    expect(formatGoalsAchievedDisplay(2, 5)).toBe("2/5");
  });

  it("uses focused Team related includes without DEMO labels", () => {
    expect(GOALS_TEAM_RELATED_INCLUDE).toContain("todos");
    expect(GOALS_TEAM_RELATED_INCLUDE).toContain("practice");
    expect(GOALS_TEAM_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(
      goalsNextActions({
        goalCount: 0,
        achieved: 0,
        needsAttention: 0,
      }).map((a) => a.id),
    ).toEqual(["workspace"]);
  });

  it("prioritizes at-risk goals from real progress", () => {
    const actions = goalsNextActions({
      orgId: "org-1",
      goalCount: 3,
      achieved: 1,
      needsAttention: 2,
      topTitle: "Qualify for districts",
    });
    expect(actions[0]?.id).toBe("attention");
    expect(actions[0]?.detail).toContain("Qualify for districts");
    expect(actions[0]?.detail).not.toMatch(/demo/i);
    expect(actions.some((a) => a.id === "todos")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
  });
});
