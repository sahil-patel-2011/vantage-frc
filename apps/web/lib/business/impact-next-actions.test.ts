import { describe, expect, it } from "vitest";
import { impactNextActions } from "./impact-next-actions";

describe("impactNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = impactNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points empty impact log at first activity plus Awards / Grants / Sponsors", () => {
    const actions = impactNextActions({ orgId: "org-1", activityCount: 0, seasonYear: 2026 });
    expect(actions.map((a) => a.id)).toEqual(["first-activity", "awards", "evidence", "grants", "sponsors"]);
    expect(actions[0]?.href).toContain("/impact");
    expect(actions[0]?.href).toContain("orgId=org-1");
    expect(actions[0]?.href).toContain("season=2026");
    expect(actions.find((a) => a.id === "awards")?.href).toBe("/team/awards?orgId=org-1");
    expect(actions.find((a) => a.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
    expect(actions.find((a) => a.id === "grants")?.href).toBe("/team/grants?orgId=org-1");
    expect(actions.find((a) => a.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /never|zero until|not a DEMO/i.test(a.detail))).toBe(true);
  });

  it("asks for duration when activities exist without hours", () => {
    const actions = impactNextActions({ orgId: "org-1", activityCount: 2, totalHours: 0 });
    expect(actions[0]).toMatchObject({ id: "hours", primary: true });
    expect(actions[0]?.detail).toMatch(/recorded minutes|never placeholder/i);
  });

  it("suggests broadening when readiness is low", () => {
    const actions = impactNextActions({
      orgId: "org-1",
      activityCount: 3,
      totalHours: 12,
      readinessScore: 0.2,
    });
    expect(actions[0]?.id).toBe("broaden");
  });
});
