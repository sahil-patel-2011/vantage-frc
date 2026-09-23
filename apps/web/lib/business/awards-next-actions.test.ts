import { describe, expect, it } from "vitest";
import { awardsNextActions } from "./awards-next-actions";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("awardsNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = awardsNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points empty workbench at catalog start only", () => {
    const actions = awardsNextActions({ orgId: "org-1", submissionCount: 0 });
    expect(actions.map((a) => a.id)).toEqual(["start"]);
    expect(actions[0]?.href).toBe("/team/awards?orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    actions.forEach((a) => expectPlainCopy(a.detail));
  });

  it("prioritizes unfinished essays over status updates", () => {
    const actions = awardsNextActions({
      orgId: "org-1",
      submissionCount: 2,
      incompleteEssayCount: 3,
      inProgressCount: 2,
    });
    expect(actions[0]).toMatchObject({ id: "draft", primary: true });
  });

  it("hides submission writes from members who cannot manage the team", () => {
    const empty = awardsNextActions({ orgId: "org-1", submissionCount: 0, canManage: false });
    expect(empty.map((action) => action.id)).toEqual(["read", "impact"]);
    expect(empty[0]?.detail).toMatch(/owner or admin/);
    expect(empty.some((action) => action.id === "start")).toBe(false);

    const ready = awardsNextActions({
      orgId: "org-1",
      submissionCount: 2,
      incompleteEssayCount: 3,
      canManage: false,
    });
    expect(ready[0]?.id).toBe("read");
    expect(ready.some((action) => action.id === "draft" || action.id === "status")).toBe(false);
    ready.forEach((action) => expectPlainCopy(action.detail));
  });

  it("suggests status updates when essays are done but none won", () => {
    const actions = awardsNextActions({
      orgId: "org-1",
      submissionCount: 1,
      incompleteEssayCount: 0,
      inProgressCount: 1,
      wonCount: 0,
    });
    expect(actions[0]?.id).toBe("status");
    expectPlainCopy(actions[0]?.detail);
  });
});
