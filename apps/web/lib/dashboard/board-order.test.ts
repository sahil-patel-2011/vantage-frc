import { describe, expect, it } from "vitest";
import {
  applyOrder,
  describePlace,
  displayBoard,
  fitPhoneRows,
  isHomePacked,
  nudgeOrder,
  packInOrder,
  packStable,
  planDrop,
  readingOrder,
} from "./board-order";
import { homeViewLayout, packDashboardLayout, type DashboardWidgetLayout, type DashboardWidgetType } from "./catalog";
import { editBoardLayout, hiddenOnHome } from "./edit-mode";
import { allianceStation, scoutMatchLabel } from "./home-widget-loaders";

const card = (i: string, type: DashboardWidgetType, x: number, y: number, w = 4, h = 3): DashboardWidgetLayout => ({
  i,
  type,
  x,
  y,
  w,
  h,
});

// The captain's board: Next match across the top, then Hours and Ask AI side by side.
const board = [
  card("n", "next_match", 0, 0, 12, 4),
  card("h", "hours_month", 0, 4),
  card("a", "ask_ai", 4, 4),
  card("t", "team_todos", 8, 4),
];

const at = (layout: DashboardWidgetLayout[], id: string) => {
  const item = layout.find((row) => row.i === id)!;
  return { x: item.x, y: item.y };
};

describe("planDrop", () => {
  it("swaps two cards of the same size", () => {
    // Ask AI dropped onto Hours this month.
    const plan = planDrop(board, "a", { col: 1.5, row: 5 }, 12);
    expect(plan.mode).toBe("swap");
    const next = applyOrder(board, plan.order);
    expect(at(next, "a")).toEqual({ x: 0, y: 4 });
    expect(at(next, "h")).toEqual({ x: 4, y: 4 });
    // No hole: Team todos did not move.
    expect(at(next, "t")).toEqual({ x: 8, y: 4 });
  });

  it("inserts before or after a card of a different size, by which half the pointer is on", () => {
    const above = planDrop(board, "t", { col: 6, row: 1 }, 12);
    expect(above.mode).toBe("before");
    expect(above.order.slice(0, 2)).toEqual(["t", "n"]);
    const below = planDrop(board, "t", { col: 6, row: 3 }, 12);
    expect(below.mode).toBe("after");
    expect(below.order.slice(0, 2)).toEqual(["n", "t"]);
  });

  it("stays put over its own slot, and drops into empty space in reading order", () => {
    expect(planDrop(board, "a", { col: 5, row: 5 }, 12).mode).toBe("stay");
    const gap = planDrop(board, "h", { col: 2, row: 9 }, 12);
    expect(gap.mode).toBe("gap");
    expect(gap.order.at(-1)).toBe("h");
    const next = applyOrder(board, gap.order);
    // Packed the Home way: Ask AI and Team todos slide left, Hours follows them.
    expect(at(next, "a")).toEqual({ x: 0, y: 4 });
    expect(at(next, "t")).toEqual({ x: 4, y: 4 });
    expect(at(next, "h")).toEqual({ x: 8, y: 4 });
  });
});

describe("the edit board, Preview and Home agree", () => {
  it("packs the edit board exactly as Home does, so a drop never leaves a hole Home closes", () => {
    // A saved board with a hole in the middle column (the tester's drop onto Hours).
    const holey = [card("n", "next_match", 0, 0, 12, 4), card("h", "hours_month", 0, 4), card("a", "ask_ai", 8, 4)];
    const edit = editBoardLayout(holey, new Map());
    const home = homeViewLayout(holey, { editing: false, shell: "ready", widgets: { next_match: { status: "live" } } });
    for (const item of edit) expect(at(home, item.i)).toEqual(at(edit, item.i));
    expect(at(edit, "a")).toEqual({ x: 4, y: 4 });
  });

  it("writes a board Home lays out unchanged", () => {
    const orders = [
      ["n", "h", "a", "t"],
      ["h", "n", "t", "a"],
      ["t", "a", "h", "n"],
    ];
    for (const order of orders) {
      const next = applyOrder(board, order);
      expect(isHomePacked(next)).toBe(true);
      expect(readingOrder(next)).toEqual(readingOrder(packDashboardLayout(next)));
    }
  });

  it("settles first-fit holes so packing again changes nothing", () => {
    const mixed = [card("a", "my_day", 0, 0, 8, 4), card("b", "hours_month", 0, 4, 8, 2), card("c", "team_todos", 8, 0, 4, 6)];
    const stable = packStable(mixed);
    expect(isHomePacked(stable)).toBe(true);
  });

  it("tucks the cards Home is hiding below the ones it shows", () => {
    const withHidden = [...board, card("s", "onboarding_checklist", 0, 0, 12, 4)];
    const next = applyOrder(withHidden, ["n", "h", "a", "t"]);
    expect(at(next, "s")).toEqual({ x: 0, y: 7 });
    expect(next.map((item) => item.i)).toEqual(withHidden.map((item) => item.i));
  });
});

describe("displayBoard", () => {
  it("stacks a phone in the desktop's reading order, left before right", () => {
    // Ask AI has the smaller id but sits right of Hours on the desktop.
    const view = [card("z-hours", "hours_month", 0, 4), card("a-ask", "ask_ai", 4, 4), card("n", "next_match", 0, 0, 12, 4)];
    const phone = displayBoard(view, 1);
    expect(readingOrder(phone)).toEqual(["n", "z-hours", "a-ask"]);
  });

  it("is the board itself on a 12-column screen", () => {
    const packed = packInOrder(board, 12);
    expect(displayBoard(packed, 12).map((item) => at(displayBoard(packed, 12), item.i))).toEqual(
      packed.map((item) => ({ x: item.x, y: item.y })),
    );
  });
});

describe("fitPhoneRows", () => {
  it("grows a phone card to what it needed on Home and restacks the rest below it, in order", () => {
    const phone = displayBoard(board, 1);
    const fitted = fitPhoneRows(phone, 1, { n: 5 });
    expect(readingOrder(fitted)).toEqual(readingOrder(phone));
    const next = fitted.find((row) => row.i === "n")!;
    expect(next.h).toBe(5);
    const second = fitted.find((row) => row.i === readingOrder(fitted)[1])!;
    expect(second.y).toBe(next.y + next.h);
  });

  it("never shrinks a card and leaves wider screens alone", () => {
    const phone = displayBoard(board, 1);
    expect(fitPhoneRows(phone, 1, { n: 1 }).find((row) => row.i === "n")!.h).toBe(phone.find((row) => row.i === "n")!.h);
    const wide = displayBoard(board, 12);
    expect(fitPhoneRows(wide, 12, { n: 9 })).toEqual(wide);
  });
});

describe("nudgeOrder and describePlace", () => {
  it("moves left and right by one card, up and down to the card above or below", () => {
    expect(nudgeOrder(board, "a", "left")).toEqual(["n", "a", "h", "t"]);
    expect(nudgeOrder(board, "t", "right")).toBeNull();
    expect(nudgeOrder(board, "h", "up")).toEqual(["h", "n", "a", "t"]);
    expect(nudgeOrder(board, "n", "up")).toBeNull();
  });

  it("says where a card goes in card words", () => {
    expect(describePlace(board, ["n", "h", "a", "t"], "a")).toBe("after Hours this month");
    expect(describePlace(board, ["a", "n", "h", "t"], "a")).toBe("first, before Next match");
    expect(describePlace(board, ["n", "a", "h", "t"], "a", "swap", "h")).toBe("swapping with Hours this month");
  });
});

describe("hiddenOnHome while setup is the hero", () => {
  it("says the setup card is at the top, not that the team is set up", () => {
    const layout = [card("s", "onboarding_checklist", 0, 0, 12, 4), card("h", "hours_month", 0, 4)];
    const widgets = { hours_month: { status: "live" }, onboarding_checklist: { status: "live" } };
    expect(hiddenOnHome(layout, { shell: "ready", widgets, teamSetupCard: true }).get("s")).toBe("setup_top");
    expect(hiddenOnHome(layout, { shell: "ready", widgets, teamSetupCard: false }).get("s")).toBe("setup_done");
  });
});

describe("scout duty words", () => {
  it("names the match and where the robot stands, from real alliance lists only", () => {
    expect(scoutMatchLabel("2026gadal_qm22")).toBe("Qual 22");
    expect(allianceStation("frc254", ["frc1", "frc254", "frc3"], ["frc4"])).toBe("Red 2");
    expect(allianceStation("frc4", ["frc1"], ["frc9", "frc8", "frc4"])).toBe("Blue 3");
    expect(allianceStation("frc5", ["frc1"], ["frc4"])).toBeNull();
  });
});

describe("moving a card first keeps the rest in order", () => {
  it("does not let the card after a full-width one jump into the hole beside the moved card", () => {
    const saved = [
      { i: "w-next", type: "next_match", x: 0, y: 0, w: 12, h: 4 },
      { i: "w-day", type: "my_day", x: 0, y: 4, w: 4, h: 3 },
      { i: "w-hours", type: "hours_month", x: 4, y: 4, w: 4, h: 3 },
      { i: "w-comp", type: "competition_snapshot", x: 8, y: 4, w: 4, h: 3 },
    ] as DashboardWidgetLayout[];
    const moved = applyOrder(saved, ["w-comp", "w-next", "w-day", "w-hours"]);
    expect(readingOrder(moved)).toEqual(["w-comp", "w-next", "w-day", "w-hours"]);
    // Home packs the saved board again; the order survives that too.
    expect(readingOrder(packDashboardLayout(moved))).toEqual(["w-comp", "w-next", "w-day", "w-hours"]);
  });
});
