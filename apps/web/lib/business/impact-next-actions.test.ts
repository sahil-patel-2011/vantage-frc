import { describe, expect, it } from "vitest";
import { impactNextActions } from "./impact-next-actions";

describe("impactNextActions Soft-UI helpers", () => {
  it("routes missing workspace to /workspace", () => {
    const actions = impactNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "workspace", href: "/workspace", primary: true });
  });

  it("points empty impact log at the first activity only", () => {
    const actions = impactNextActions({ orgId: "org-1", activityCount: 0, seasonYear: 2026 });
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("first-activity");
    expect(actions[0]?.href).toContain("/impact");
    expect(actions[0]?.href).toContain("orgId=org-1");
    expect(actions[0]?.href).toContain("season=2026");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.some((a) => /zero until/i.test(a.detail))).toBe(true);
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
    expect(actions.map((a) => a.id)).not.toContain("grants");
    expect(actions.map((a) => a.id)).not.toContain("sponsors");
  });
});
