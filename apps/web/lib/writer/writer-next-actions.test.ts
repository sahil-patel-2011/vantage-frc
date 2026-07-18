import { describe, expect, it } from "vitest";
import { writerNextActions } from "./writer-next-actions";

describe("writerNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = writerNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("asks for mission/achievements when the profile is thin", () => {
    const actions = writerNextActions({
      orgId: "org-1",
      draftCount: 0,
      hasMission: false,
      hasAchievements: false,
    });
    expect(actions[0]).toMatchObject({ id: "profile", primary: true });
    expect(actions[0]?.detail).toMatch(/never DEMO|empty fields/i);
  });

  it("cross-links Grants, Awards, and Knowledge for a ready profile", () => {
    const actions = writerNextActions({
      orgId: "org-1",
      draftCount: 2,
      hasMission: true,
      hasAchievements: true,
    });
    expect(actions.map((a) => a.id)).toEqual(["grants", "awards", "knowledge"]);
    expect(actions.find((a) => a.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(actions.find((a) => a.id === "awards")?.href).toBe("/team/awards?orgId=org-1");
    expect(actions.find((a) => a.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /never DEMO|not invented|fabricated/i.test(a.detail))).toBe(true);
  });

  it("prompts first compose when profile is filled but library is empty", () => {
    const actions = writerNextActions({
      orgId: "org-1",
      draftCount: 0,
      hasMission: true,
      hasAchievements: true,
    });
    expect(actions[0]).toMatchObject({ id: "compose", primary: true });
    expect(actions[0]?.href).toBe("/ai?tab=writer&orgId=org-1");
    expect(actions.map((a) => a.id)).toContain("grants");
    expect(actions.map((a) => a.id)).toContain("awards");
    expect(actions.map((a) => a.id)).toContain("knowledge");
  });

  it("routes thin-profile handoff into the AI hub Writer tab", () => {
    const actions = writerNextActions({
      orgId: "org-1",
      draftCount: 0,
      hasMission: false,
      hasAchievements: true,
    });
    expect(actions[0]).toMatchObject({ id: "profile", href: "/ai?tab=writer&orgId=org-1", primary: true });
  });
});