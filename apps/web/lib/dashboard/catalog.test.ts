import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGET_TYPES,
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_CATALOG,
  applyWidgetSize,
  canAccessWidget,
  canWriteOrgDashboard,
  dashboardGridForWidth,
  dashboardRectsOverlap,
  defaultDashboardLayoutForAudience,
  findDashboardSlot,
  filterLayoutForRole,
  homeViewLayout,
  inferWidgetSize,
  layoutOrAudienceDefault,
  packDashboardLayout,
  scaleLayoutToCols,
  validateDashboardLayout,
  widgetRegistryMeta,
} from "./catalog";

describe("dashboard catalog persistence helpers", () => {
  it("ships a coherent default home with 3–6 high-value widgets", () => {
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_DASHBOARD_LAYOUT.length).toBeLessThanOrEqual(6);
    expect(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.type)).toEqual(
      expect.arrayContaining(["next_match", "competition_snapshot", "robot_readiness", "alerts"]),
    );
    expect(DEFAULT_DASHBOARD_LAYOUT.some((item) => item.type === "onboarding_checklist")).toBe(false);
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

  it("picks phone 1/2-col, tablet 4-col, and laptop 12-col grids", () => {
    expect(dashboardGridForWidth(320).cols).toBe(1);
    expect(dashboardGridForWidth(390).cols).toBe(1);
    expect(dashboardGridForWidth(480).cols).toBe(2);
    expect(dashboardGridForWidth(800).cols).toBe(4);
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
  it("hides empty cards in view mode and keeps next match as the hero", () => {
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
          recent_result: { status: "empty" },
          scouting_coverage: { status: "empty" },
        },
      },
    );
    expect(viewed.map((item) => item.type)).toEqual(["next_match", "alerts"]);
    expect(viewed.find((item) => item.type === "next_match")?.w).toBe(12);
    expect(viewed.some((item) => item.type === "onboarding_checklist")).toBe(false);
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

describe("widget registry", () => {
  it("lists every widget type exactly once with sizes, empty condition, and a help article", () => {
    const types = WIDGET_CATALOG.map((entry) => entry.type);
    expect(new Set(types).size).toBe(DASHBOARD_WIDGET_TYPES.length);
    expect(types.sort()).toEqual([...DASHBOARD_WIDGET_TYPES].sort());
    for (const entry of WIDGET_CATALOG) {
      const meta = widgetRegistryMeta(entry);
      expect(meta.sizes.length, entry.type).toBeGreaterThan(0);
      expect(meta.emptyWhen.length, entry.type).toBeGreaterThan(3);
      expect(meta.helpArticle.length, entry.type).toBeGreaterThan(2);
      expect(meta.audience.length, entry.type).toBeGreaterThan(0);
      expect(entry.description, entry.type).not.toMatch(/\b(EPA|Statbotics|reference tables)\b/);
    }
  });

  it("ships student vs mentor defaults that a new member can actually open", () => {
    const student = defaultDashboardLayoutForAudience("student");
    const mentor = defaultDashboardLayoutForAudience("mentor");
    expect(student.map((item) => item.type)).toEqual([
      "next_match",
      "my_day",
      "learn_progress",
      "team_todos",
      "files_recent",
      "team_chat",
      "ask_ai",
    ]);
    expect(mentor.map((item) => item.type)).toEqual([
      "next_match",
      "duties",
      "budget_parts",
      "attendance",
      "outreach_hours",
      "announcements_ack",
    ]);
    expect(validateDashboardLayout(student, "scout").ok).toBe(true);
    expect(validateDashboardLayout(mentor, "admin").ok).toBe(true);
    expect(validateDashboardLayout(mentor, "scout").ok).toBe(false);
  });

  it("empty Home fallback is the audience board, not the competition set", () => {
    const student = layoutOrAudienceDefault([], "student");
    const mentor = layoutOrAudienceDefault(undefined, "mentor");
    expect(student.map((item) => item.type)).toContain("my_day");
    expect(student.map((item) => item.type)).not.toContain("competition_snapshot");
    expect(mentor.map((item) => item.type)).toContain("duties");
    expect(mentor.map((item) => item.type)).not.toContain("competition_snapshot");
    const kept = defaultDashboardLayoutForAudience("student");
    expect(layoutOrAudienceDefault(kept, "mentor")).toBe(kept);
    expect(layoutOrAudienceDefault(null, null).map((item) => item.type)).toEqual(
      defaultDashboardLayoutForAudience("student").map((item) => item.type),
    );
  });

  it("Home client and dashboard API do not fall back to the competition board", () => {
    const roots = join(__dirname, "..", "..");
    const files = [
      join(roots, "app", "dashboard", "use-dashboard-home-state.ts"),
      join(roots, "app", "dashboard", "use-dashboard-board-ops.ts"),
      join(roots, "app", "api", "dashboards", "route.ts"),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bDEFAULT_DASHBOARD_LAYOUT\b/);
    }
  });
});
