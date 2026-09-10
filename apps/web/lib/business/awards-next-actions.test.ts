import { describe, expect, it } from "vitest";
import { awardsNextActions } from "./awards-next-actions";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("awardsNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = awardsNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points empty workbench at catalog start plus Impact / Grants / Sponsors", () => {
    const actions = awardsNextActions({ orgId: "org-1", submissionCount: 0 });
    expect(actions.map((a) => a.id)).toEqual(["start", "impact", "evidence", "grants", "sponsors"]);
    expect(actions[0]?.href).toBe("/team/awards?orgId=org-1");
    expect(actions.find((a) => a.id === "impact")?.href).toBe("/impact?orgId=org-1");
    expect(actions.find((a) => a.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(actions.find((a) => a.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(actions.find((a) => a.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /empty is not|never DEMO|never fabricated/i.test(a.detail))).toBe(true);
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
