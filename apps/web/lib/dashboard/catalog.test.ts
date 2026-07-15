import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  canAccessWidget,
  canWriteOrgDashboard,
  filterLayoutForRole,
  validateDashboardLayout,
} from "./catalog";

describe("dashboard catalog persistence helpers", () => {
  it("ships a coherent default home with 3–5 high-value widgets", () => {
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeLessThanOrEqual(5);
    expect(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.type)).toEqual(
      expect.arrayContaining(["next_match", "robot_readiness", "alerts"]),
    );
    const validated = validateDashboardLayout(DEFAULT_DASHBOARD_LAYOUT, "scout");
    expect(validated.ok).toBe(true);
  });

  it("rejects oversized layouts and unknown widgets", () => {
    expect(validateDashboardLayout({} as unknown, "scout").ok).toBe(false);
    expect(
      validateDashboardLayout(
        [{ i: "x", type: "not_real", x: 0, y: 0, w: 4, h: 3 }],
        "admin",
      ).ok,
    ).toBe(false);
    expect(
      validateDashboardLayout(
        [{ i: "x", type: "next_match", x: 0, y: 0, w: 1, h: 1 }],
        "admin",
      ).ok,
    ).toBe(true); // undersized values are raised to catalog mins
  });

  it("persists layout ids and clamps width to the 12-column grid", () => {
    const validated = validateDashboardLayout(
      [
        { i: "a", type: "quick_actions", x: 0, y: 0, w: 20, h: 3 },
        { type: "alerts", x: 0, y: 3, w: 4, h: 3 },
      ],
      "owner",
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.layout[0]!.w).toBe(12);
    expect(validated.layout[1]!.i).toMatch(/^w-alerts-/);
  });
});

describe("dashboard tenant and role isolation rules", () => {
  it("gates AI usage to owner/admin and filters it from scout layouts", () => {
    expect(canAccessWidget("ai_usage", "owner")).toBe(true);
    expect(canAccessWidget("ai_usage", "admin")).toBe(true);
    expect(canAccessWidget("ai_usage", "scout")).toBe(false);
    expect(canAccessWidget("next_match", "viewer")).toBe(true);

    const withAi = [
      ...DEFAULT_DASHBOARD_LAYOUT,
      { i: "ai", type: "ai_usage" as const, x: 0, y: 10, w: 4, h: 3 },
    ];
    expect(filterLayoutForRole(withAi, "scout").some((item) => item.type === "ai_usage")).toBe(false);
    expect(filterLayoutForRole(withAi, "admin").some((item) => item.type === "ai_usage")).toBe(true);
    expect(validateDashboardLayout(withAi, "scout").ok).toBe(false);
    expect(validateDashboardLayout(withAi, "admin").ok).toBe(true);
  });

  it("only allows owner/admin to write org-shared dashboards", () => {
    expect(canWriteOrgDashboard("owner")).toBe(true);
    expect(canWriteOrgDashboard("admin")).toBe(true);
    expect(canWriteOrgDashboard("scout")).toBe(false);
    expect(canWriteOrgDashboard("viewer")).toBe(false);
    expect(canWriteOrgDashboard(null)).toBe(false);
  });

  it("rejects duplicate widget ids used for persistence keys", () => {
    const duplicate = validateDashboardLayout(
      [
        { i: "same", type: "alerts", x: 0, y: 0, w: 4, h: 3 },
        { i: "same", type: "notifications", x: 4, y: 0, w: 4, h: 3 },
      ],
      "admin",
    );
    expect(duplicate.ok).toBe(false);
  });
});
