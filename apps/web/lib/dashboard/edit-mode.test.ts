import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGET_TYPES,
  WIDGET_CATALOG,
  emptyHomeWidgets,
  homeViewLayout,
  packDashboardLayout,
  scaleLayoutToCols,
  type DashboardWidgetLayout,
} from "./catalog";
import { compactLayout } from "./grid-drag";
import {
  EDIT_HISTORY_LIMIT,
  WIDGET_GROUP,
  editBoardLayout,
  groupWidgetRows,
  hiddenOnHome,
  layoutForEditing,
  layoutsEqual,
  packInColumns,
  packKeepingOrder,
  popHistory,
  pushHistory,
  setAlwaysShow,
  suggestBoardName,
  tidyBoard,
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

describe("Always show", () => {
  const widgets = { hours_month: { status: "empty" }, onboarding_checklist: { status: "live" } };
  const layout = [card("h", "hours_month", 0, 0), card("c", "onboarding_checklist", 4, 0, 6, 3)];

  it("keeps an empty card and a finished setup card on Home", () => {
    expect(hiddenOnHome(layout, { shell: "ready", widgets }).size).toBe(2);
    const always = setAlwaysShow(setAlwaysShow(layout, "h", true), "c", true);
    expect(hiddenOnHome(always, { shell: "ready", widgets }).size).toBe(0);
    expect(homeViewLayout(always, { editing: false, shell: "ready", widgets }).map((item) => item.i).sort()).toEqual(["c", "h"]);
    expect(emptyHomeWidgets(always, widgets)).toEqual([]);
  });

  it("counts as a change, and turning it off drops the flag", () => {
    const always = setAlwaysShow(layout, "h", true);
    expect(layoutsEqual(layout, always)).toBe(false);
    const off = setAlwaysShow(always, "h", false);
    expect(off[0]?.config).toBeUndefined();
    expect(layoutsEqual(layout, off)).toBe(true);
  });

  it("keeps other config on the card", () => {
    const withConfig = [{ ...card("p", "pit_youtube"), config: { url: "x" } }];
    expect(setAlwaysShow(withConfig, "p", true)[0]?.config).toEqual({ url: "x", alwaysShow: true });
    expect(setAlwaysShow(setAlwaysShow(withConfig, "p", true), "p", false)[0]?.config).toEqual({ url: "x" });
  });
});

describe("editBoardLayout and layoutForEditing", () => {
  const layout = [card("s", "onboarding_checklist", 0, 0, 12, 4), card("a", "my_day", 0, 4), card("b", "hours_month", 4, 4)];
  const hidden = new Map([
    ["s", "setup_done"],
    ["a", "empty"],
  ]);

  it("leaves hidden cards off the board", () => {
    expect(editBoardLayout(layout, hidden).map((item) => item.i)).toEqual(["b"]);
  });

  it("starts the draft where Home shows the cards, with hidden ones below", () => {
    const start = layoutForEditing(layout, hidden);
    expect(start.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
    // Below everything Home shows, in their own reading order.
    expect(start.find((item) => item.i === "s")).toMatchObject({ x: 0, y: 3 });
    expect(start.find((item) => item.i === "a")).toMatchObject({ x: 0, y: 7 });
    expect(start.map((item) => item.i)).toEqual(["s", "a", "b"]);
  });

  it("keeps a card added in this edit even if it is empty", () => {
    const layout = [card("a", "my_day", 0, 0)];
    expect(editBoardLayout(layout, new Map([["a", "empty"]]), new Set(["a"])).map((item) => item.i)).toEqual(["a"]);
  });
});

describe("packInColumns", () => {
  it("closes gaps across as well as up, in reading order", () => {
    const packed = packInColumns([card("a", "my_day", 0, 0, 1, 3), card("b", "hours_month", 1, 0, 1, 3), card("c", "team_todos", 3, 0, 1, 3)], 4);
    expect(packed.map((item) => item.x)).toEqual([0, 1, 2]);
  });
});

describe("tidyBoard", () => {
  const displayAt = (cols: number) => (layout: DashboardWidgetLayout[]) =>
    compactLayout(scaleLayoutToCols(packDashboardLayout(layout), 12, cols), cols);

  it("never rewrites card widths from a tablet view", () => {
    // Three 4-wide cards scale to columns 1, 2 and 4 of a 4-column tablet. That hole is
    // rounding; packing the tablet view and scaling it back made the desktop cards 3 wide.
    const layout = [card("a", "my_day", 0, 0), card("b", "hours_month", 4, 0), card("c", "team_todos", 8, 0)];
    const result = tidyBoard({ layout, visibleIds: new Set(["a", "b", "c"]), cols: 4, displayFor: displayAt(4) });
    expect(result).toEqual({ layout, moved: false });
  });

  it("does not claim a move when the board is already tidy", () => {
    const layout = [card("a", "my_day", 0, 0), card("b", "hours_month", 4, 0)];
    const result = tidyBoard({ layout, visibleIds: new Set(["a", "b"]), cols: 12, displayFor: displayAt(12) });
    expect(result).toEqual({ layout, moved: false });
  });

  it("closes a gap left by a dragged card on the full board", () => {
    const layout = [card("a", "my_day", 0, 0), card("b", "hours_month", 8, 0)];
    const display = (next: DashboardWidgetLayout[]) => compactLayout(next, 12);
    const result = tidyBoard({ layout, visibleIds: new Set(["a", "b"]), cols: 12, displayFor: display });
    expect(result.moved).toBe(true);
    expect(result.layout.find((item) => item.i === "b")).toMatchObject({ x: 4, y: 0 });
  });
});

describe("suggestBoardName", () => {
  it("suggests Match day, then numbers it", () => {
    expect(suggestBoardName([])).toBe("Match day");
    expect(suggestBoardName(["match day"])).toBe("Match day 2");
    expect(suggestBoardName(["Match day", "Match day 2"])).toBe("Match day 3");
  });
});

describe("widget search keywords", () => {
  it("finds pit tools by 'pit' and budget by 'money'", () => {
    const find = (query: string) =>
      WIDGET_CATALOG.filter((entry) => widgetMatchesSearch(entry, query)).map((entry) => entry.type);
    expect(find("pit")).toEqual(expect.arrayContaining(["batteries", "robot_readiness"]));
    expect(find("money")).toContain("budget_parts");
  });
});
