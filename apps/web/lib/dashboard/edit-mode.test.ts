import { describe, expect, it } from "vitest";
import { DASHBOARD_WIDGET_TYPES, WIDGET_CATALOG, type DashboardWidgetLayout } from "./catalog";
import {
  EDIT_HISTORY_LIMIT,
  WIDGET_GROUP,
  groupWidgetRows,
  hiddenOnHome,
  layoutsEqual,
  packKeepingOrder,
  popHistory,
  pushHistory,
  suggestBoardName,
  widgetMatchesSearch,
} from "./edit-mode";

const card = (i: string, type: DashboardWidgetLayout["type"], x = 0, y = 0, w = 4, h = 3): DashboardWidgetLayout => ({
  i,
  type,
  x,
  y,
  w,
  h,
});

describe("widget groups", () => {
  it("puts every widget type in a group", () => {
    for (const type of DASHBOARD_WIDGET_TYPES) expect(WIDGET_GROUP[type]).toBeTruthy();
  });

  it("groups rows in the sheet's order and drops empty groups", () => {
    const rows = WIDGET_CATALOG.filter((entry) => ["my_day", "next_match", "batteries"].includes(entry.type)).map(
      (entry) => ({ entry }),
    );
    const groups = groupWidgetRows(rows);
    expect(groups.map((group) => group.label)).toEqual(["Match day", "Build", "Me"]);
  });

  it("searches names, descriptions and group names", () => {
    const next = WIDGET_CATALOG.find((entry) => entry.type === "next_match")!;
    expect(widgetMatchesSearch(next, "NEXT")).toBe(true);
    expect(widgetMatchesSearch(next, "bumper")).toBe(true);
    expect(widgetMatchesSearch(next, "match day")).toBe(true);
    expect(widgetMatchesSearch(next, "battery")).toBe(false);
    expect(widgetMatchesSearch(next, "  ")).toBe(true);
  });
});

describe("edit history", () => {
  const a = [card("a", "my_day")];
  const b = [card("a", "my_day", 4)];

  it("compares layouts regardless of array order", () => {
    expect(layoutsEqual([card("a", "my_day"), card("b", "alerts", 4)], [card("b", "alerts", 4), card("a", "my_day")])).toBe(
      true,
    );
    expect(layoutsEqual(a, b)).toBe(false);
    expect(layoutsEqual(null, [])).toBe(true);
  });

  it("pushes, skips a repeat of the top, and pops in reverse", () => {
    let stack = pushHistory([], a);
    stack = pushHistory(stack, a);
    expect(stack).toHaveLength(1);
    stack = pushHistory(stack, b);
    const first = popHistory(stack);
    expect(first.layout).toEqual(b);
    const second = popHistory(first.stack);
    expect(second.layout).toEqual(a);
    expect(popHistory(second.stack).layout).toBeNull();
  });

  it("forgets the oldest step past the limit", () => {
    let stack: DashboardWidgetLayout[][] = [];
    for (let n = 0; n < EDIT_HISTORY_LIMIT + 5; n += 1) stack = pushHistory(stack, [card("a", "my_day", n % 9, n)]);
    expect(stack).toHaveLength(EDIT_HISTORY_LIMIT);
    expect(stack[0]?.[0]?.y).toBe(5);
  });
});

describe("packKeepingOrder", () => {
  it("closes gaps without reordering the array", () => {
    const layout = [card("b", "alerts", 8, 3), card("a", "my_day", 0, 3), card("hero", "next_match", 0, 0, 12, 3)];
    const packed = packKeepingOrder(layout);
    expect(packed.map((item) => item.i)).toEqual(["b", "a", "hero"]);
    expect(packed.find((item) => item.i === "a")).toMatchObject({ x: 0, y: 3 });
    // The hole between a (0-4) and b (8-12) closes: b slides left to 4.
    expect(packed.find((item) => item.i === "b")).toMatchObject({ x: 4, y: 3 });
  });
});

describe("hiddenOnHome", () => {
  it("names the empty cards the normal view leaves out, and why", () => {
    const layout = [card("n", "next_match", 0, 0, 12, 4), card("h", "hours_month", 0, 4), card("c", "onboarding_checklist", 4, 4)];
    const hidden = hiddenOnHome(layout, {
      shell: "ready",
      widgets: { next_match: { status: "empty" }, hours_month: { status: "empty" }, onboarding_checklist: { status: "live" } },
    });
    // Next match always stays; the empty hours card and the finished setup card do not.
    expect(hidden.has("n")).toBe(false);
    expect(hidden.get("h")).toBe("empty");
    expect(hidden.get("c")).toBe("setup_done");
  });

  it("hides nothing that has data", () => {
    const layout = [card("h", "hours_month")];
    expect(hiddenOnHome(layout, { shell: "ready", widgets: { hours_month: { status: "live" } } }).size).toBe(0);
  });
});

describe("suggestBoardName", () => {
  it("suggests Match day, then numbers it", () => {
    expect(suggestBoardName([])).toBe("Match day");
    expect(suggestBoardName(["match day"])).toBe("Match day 2");
    expect(suggestBoardName(["Match day", "Match day 2"])).toBe("Match day 3");
  });
});
