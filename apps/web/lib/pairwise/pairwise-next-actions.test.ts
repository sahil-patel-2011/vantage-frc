import { describe, expect, it } from "vitest";
import { pairwiseNextActions } from "./pairwise-next-actions";

describe("pairwise next actions", () => {
  it("asks for a workspace when none is selected", () => {
    expect(pairwiseNextActions({})[0]?.id).toBe("workspace");
  });

  it("points empty desks at the first qualitative tap", () => {
    const actions = pairwiseNextActions({ orgId: "org-1", comparisonCount: 0 });
    expect(actions[0]?.id).toBe("first-tap");
    expect(actions[0]?.href).toContain("/pairwise");
    expect(actions.some((action) => action.id === "pick-list")).toBe(false);
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });

  it("points a recorded order at the canonical pick list", () => {
    const actions = pairwiseNextActions({
      orgId: "org-1",
      comparisonCount: 4,
      rankCount: 3,
      eventKey: "2026onto",
    });
    expect(actions.some((action) => action.id === "pick-list")).toBe(true);
    expect(actions.find((action) => action.id === "pick-list")?.href).toContain("picklist-collab");
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });
});
