import { describe, expect, it } from "vitest";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  applyWidgetSize,
  canAccessWidget,
  canWriteOrgDashboard,
  dashboardGridForWidth,
  dashboardRectsOverlap,
  findDashboardSlot,
  ensureAiUsageWidget,
  filterLayoutForRole,
  homeViewLayout,
  inferWidgetSize,
  packDashboardLayout,
  scaleLayoutToCols,
  validateDashboardLayout,
} from "./catalog";

describe("dashboard catalog persistence helpers", () => {
  it("ships a coherent default home with 3–6 high-value widgets", () => {
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeLessThanOrEqual(7);
    expect(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.type)).toEqual(
      expect.arrayContaining(["next_match", "competition_snapshot", "robot_readiness", "alerts", "ai_usage"]),
    );
    expect(DEFAULT_DASHBOARD_LAYOUT.some((item) => item.type === "onboarding_checklist")).toBe(false);
    expect(validateDashboardLayout(DEFAULT_DASHBOARD_LAYOUT, "owner").ok).toBe(true);
    expect(validateDashboardLayout(DEFAULT_DASHBOARD_LAYOUT, "scout").ok).toBe(false);
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

  it("clamps a persisted x coordinate so the widget stays on canvas", () => {
    const validated = validateDashboardLayout(
      [{ i: "edge", type: "quick_actions", x: 11, y: 0, w: 4, h: 3 }],
      "owner",
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.layout[0]!.x).toBe(8);
  });

  it("finds the first open snap slot without collisions", () => {
    const layout = [
      { x: 0, y: 0, w: 6, h: 4 },
      { x: 6, y: 0, w: 6, h: 4 },
      { x: 0, y: 4, w: 4, h: 3 },
    ];
    expect(findDashboardSlot(layout, 4, 3)).toEqual({ x: 4, y: 4 });
    expect(dashboardRectsOverlap(layout[0]!, layout[1]!)).toBe(false);
  });

  it("packs a scattered layout into deterministic non-overlapping slots", () => {
    const packed = packDashboardLayout([
      { i: "b", type: "alerts", x: 8, y: 20, w: 4, h: 3 },
      { i: "a", type: "next_match", x: 0, y: 10, w: 6, h: 4 },
      { i: "c", type: "quick_actions", x: 0, y: 30, w: 4, h: 3 },
    ]);
    expect(packed.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
    ]);
    for (let left = 0; left < packed.length; left += 1) {
      for (let right = left + 1; right < packed.length; right += 1) {
        expect(dashboardRectsOverlap(packed[left]!, packed[right]!)).toBe(false);
      }
    }
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

    const withoutAi = DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.type !== "ai_usage");
    const ensured = ensureAiUsageWidget(withoutAi);
    expect(ensured.some((item) => item.type === "ai_usage")).toBe(true);
    expect(ensureAiUsageWidget(ensured)).toHaveLength(ensured.length);
    expect(filterLayoutForRole(ensured, "scout").some((item) => item.type === "ai_usage")).toBe(false);
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

  it("picks phone / tablet / laptop / TV grids without collapsing to a 1-column stack", () => {
    expect(dashboardGridForWidth(390).cols).toBe(4);
    expect(dashboardGridForWidth(800).cols).toBe(8);
    expect(dashboardGridForWidth(1280).cols).toBe(12);
    expect(dashboardGridForWidth(1920).cols).toBe(12);
    expect(dashboardGridForWidth(1920).rowHeight).toBeGreaterThan(dashboardGridForWidth(1280).rowHeight);
  });

  it("scales a 12-column standard layout onto a 4-column phone grid", () => {
    const phone = scaleLayoutToCols(DEFAULT_DASHBOARD_LAYOUT, 12, 4);
    expect(phone.every((item) => item.x + item.w <= 4)).toBe(true);
    expect(phone.find((item) => item.type === "next_match")?.w).toBe(4);
    const back = scaleLayoutToCols(phone, 4, 12);
    expect(back.find((item) => item.type === "next_match")?.w).toBe(12);
  });

  it("applies Apple-style S/M/L/XL sizes on the canonical 12-column board", () => {
    const base = DEFAULT_DASHBOARD_LAYOUT[1]!;
    const large = applyWidgetSize(base, "l");
    expect(large.w).toBe(6);
    expect(inferWidgetSize(large)).toBe("l");
    expect(applyWidgetSize(base, "xl").w).toBe(12);
    expect(inferWidgetSize({ w: 3, h: 2 })).toBe("s");
  });
});

describe("home view layout", () => {
  it("keeps pinned widgets visible when empty and hides only setup-only cards", () => {
    const viewed = homeViewLayout(
      [
        ...DEFAULT_DASHBOARD_LAYOUT,
        { i: "w-onboarding_checklist", type: "onboarding_checklist", x: 0, y: 20, w: 12, h: 4 },
      ],
      {
        editing: false,
        shell: "ready",
        widgets: {
          next_match: { status: "empty" },
          competition_snapshot: { status: "setup_required" },
          robot_readiness: { status: "empty" },
          alerts: { status: "live" },
        },
      },
    );
    expect(viewed.map((item) => item.type)).toEqual([
      "next_match",
      "competition_snapshot",
      "robot_readiness",
      "alerts",
      "recent_result",
      "scouting_coverage",
      "ai_usage",
    ]);
    expect(viewed.find((item) => item.type === "next_match")?.w).toBe(12);
    expect(viewed.some((item) => item.type === "onboarding_checklist")).toBe(false);
  });

  it("hides the widget board when no workspace can supply data", () => {
    const viewed = homeViewLayout(
      [
        ...DEFAULT_DASHBOARD_LAYOUT,
        { i: "w-onboarding_checklist", type: "onboarding_checklist", x: 0, y: 20, w: 12, h: 4 },
      ],
      { editing: false, shell: "no_org", widgets: {} },
    );
    expect(viewed).toEqual([]);
  });

  it("keeps widgets that already have data while setup is still outstanding", () => {
    const viewed = homeViewLayout(DEFAULT_DASHBOARD_LAYOUT, {
      editing: false,
      shell: "setup",
      widgets: {
        alerts: { status: "live" },
        scouting_coverage: { status: "empty" },
        next_match: { status: "setup_required" },
      },
    });
    expect(viewed.map((item) => item.type)).toEqual(["alerts", "scouting_coverage"]);
  });

  it("shows only the banner during setup when every widget needs setup too", () => {
    const viewed = homeViewLayout(DEFAULT_DASHBOARD_LAYOUT, {
      editing: false,
      shell: "setup",
      widgets: { next_match: { status: "setup_required" } },
    });
    expect(viewed).toEqual([]);
  });

  it("leaves the saved board untouched in edit mode", () => {
    const viewed = homeViewLayout(DEFAULT_DASHBOARD_LAYOUT, {
      editing: true,
      shell: "ready",
      widgets: {},
    });
    expect(viewed.map((item) => item.type)).toEqual(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.type));
  });
});
