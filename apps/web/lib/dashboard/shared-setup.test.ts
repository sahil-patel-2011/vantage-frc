import { describe, expect, it } from "vitest";
import { homeViewLayout, type DashboardWidgetLayout } from "./catalog";
import { hiddenOnHome } from "./edit-mode";
import { dashboardNextActions } from "./dashboard-related";
import { buildStudentHomeStrip } from "../home-workflows";

const layout: DashboardWidgetLayout[] = [
  { i: "setup", type: "onboarding_checklist", x: 0, y: 0, w: 12, h: 4, config: { alwaysShow: true } },
  { i: "match", type: "next_match", x: 0, y: 4, w: 12, h: 5 },
  { i: "coverage", type: "scouting_coverage", x: 0, y: 9, w: 6, h: 4 },
  { i: "todos", type: "team_todos", x: 6, y: 9, w: 6, h: 4 },
];
const input = {
  shell: "setup" as const, sharedSetupPrompt: true,
  widgets: { setup: { status: "live" }, match: { status: "setup_required" }, coverage: { status: "empty" }, todos: { status: "live" } },
};

describe("one shared Home setup prompt", () => {
  it("does not promote zero personal tasks into an extra all-clear section", () => {
    const strip = buildStudentHomeStrip({ orgId: "team-id", nextPracticeTitle: null, nextPracticeAt: null,
      hotelName: null, roomLabel: null, mineOpenTodos: 0, kickoffReady: false });
    expect(strip.filter(item => item.tone !== "neutral")).toEqual([]);
  });
  it("consolidates missing-event placeholders and preserves real work and saved preferences", () => {
    const original = structuredClone(layout);
    expect(homeViewLayout(layout, { ...input, editing: false }).map(row => row.i)).toEqual(["setup", "todos"]);
    expect(layout).toEqual(original);
    expect(hiddenOnHome(layout, input)).toEqual(new Map([
      ["match", "setup_shared"], ["coverage", "setup_shared"],
    ]));
    expect(homeViewLayout(layout, { ...input, editing: true })).toEqual(original);
  });

  it("restores real match cards as soon as data arrives, including while another setup step remains", () => {
    const widgets = { ...input.widgets, match: { status: "live" } };
    expect(homeViewLayout(layout, { ...input, widgets, editing: false }).some(row => row.i === "match")).toBe(true);
    expect(hiddenOnHome(layout, { ...input, widgets }).has("match")).toBe(false);
    const ready = homeViewLayout(layout, { shell: "ready", widgets, editing: false });
    expect(ready.some(row => row.i === "setup")).toBe(true); // Explicit pin remains saved.
    expect(ready.some(row => row.i === "match")).toBe(true);
  });

  it("integrates coverage into the overview while preserving its saved card and editor explanation", () => {
    const widgets = { ...input.widgets, coverage: { status: "live" } };
    const original = structuredClone(layout);
    const viewed = homeViewLayout(layout, { editing: false, shell: "ready", widgets, homeOverview: true });
    expect(viewed.some(item => item.i === "coverage")).toBe(false);
    expect(hiddenOnHome(layout, { shell: "ready", widgets, homeOverview: true }).get("coverage")).toBe("integrated");
    expect(layout).toEqual(original);
    expect(homeViewLayout(layout, { editing: true, shell: "ready", widgets, homeOverview: true })).toEqual(original);
  });

  it("keeps errors and pending loads visible rather than disguising them as missing setup", () => {
    for (const status of [undefined, "error", "offline"]) {
      const widgets = { ...input.widgets, match: { status } };
      expect(homeViewLayout(layout, { ...input, widgets, editing: false }).some(row => row.i === "match")).toBe(true);
    }
  });
  it("moves a live stock match into the leading overview and keeps an explicitly positioned match", () => {
    const hero: DashboardWidgetLayout = { i: "next", type: "next_match", x: 0, y: 0, w: 12, h: 4 };
    const input = { shell: "ready" as const, homeOverview: true, widgets: { next_match: { status: "live" } } };
    expect(homeViewLayout([hero], { ...input, editing: false })).toEqual([]);
    expect(hiddenOnHome([hero], input).get("next")).toBe("integrated");
    expect(homeViewLayout([hero], { ...input, editing: true })).toEqual([hero]);
    const pinned = { ...hero, config: { alwaysShow: true } };
    expect(homeViewLayout([pinned], { ...input, editing: false })).toEqual([pinned]);
  });
  it("folds stock tasks and schedule into Home without changing saved layouts or hiding explicit pins", () => {
    const stock: DashboardWidgetLayout[] = [
      { i: "tasks", type: "team_todos", x: 0, y: 0, w: 6, h: 4 },
      { i: "day", type: "my_day", x: 6, y: 0, w: 6, h: 4 },
      { i: "calendar", type: "calendar_today", x: 0, y: 4, w: 6, h: 4 },
    ];
    const original = structuredClone(stock);
    const input = { shell: "ready" as const, homeOverview: true, widgets: { team_todos: { status: "live" }, my_day: { status: "live" }, calendar_today: { status: "live" } } };
    expect(homeViewLayout(stock, { ...input, editing: false })).toEqual([]);
    expect([...hiddenOnHome(stock, input).values()]).toEqual(["integrated", "integrated", "integrated"]);
    expect(homeViewLayout(stock, { ...input, editing: true })).toEqual(original);
    const pinned = stock.map(item => ({ ...item, config: { alwaysShow: true } }));
    expect(homeViewLayout(pinned, { ...input, editing: false }).map(item => item.i)).toEqual(["tasks", "day", "calendar"]);
    expect(stock).toEqual(original);
  });

  it("routes team leads directly to the event chooser and scouts to practice", () => {
    for (const role of ["owner", "admin"]) {
      const [action] = dashboardNextActions({ orgId: "team-id", shell: "setup", role });
      expect(action?.label).toBe("Choose event");
      expect(action?.href).toContain("pickEvent=1");
      expect(action?.href).toContain("orgId=team-id");
    }
    const [scout] = dashboardNextActions({ orgId: "team-id", shell: "setup", role: "scout" });
    expect(scout?.href).toContain("mode=free");
    expect(scout?.href).not.toContain("pickEvent");
    const [viewer] = dashboardNextActions({ orgId: "team-id", shell: "setup", role: "viewer" });
    expect(viewer?.label).toBe("Open Scouting");
    expect(viewer?.href).not.toContain("mode=free");
  });
});
