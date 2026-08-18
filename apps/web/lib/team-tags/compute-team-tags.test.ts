import { describe, expect, it } from "vitest";
import { teamTagsNextActions } from "./compute-team-tags";

describe("team-tags next actions", () => {
  it("asks for a workspace when none is selected", () => {
    expect(teamTagsNextActions({})[0]?.id).toBe("workspace");
  });

  it("points empty boards at the first real tag", () => {
    const actions = teamTagsNextActions({ orgId: "org-1", assignmentCount: 0 });
    expect(actions[0]?.id).toBe("first-tag");
    expect(actions[0]?.href).toContain("/team-tags");
    expect(actions.some((action) => action.id === "pairwise")).toBe(true);
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });
});
