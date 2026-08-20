import { describe, expect, it } from "vitest";
import { canWriteOrgDashboard, dashboardRectsOverlap, DEFAULT_DASHBOARD_LAYOUT } from "./catalog";
import {
  applyGridDrag,
  boardStorageKey,
  dropWidgetOntoLayout,
  pickHomeBoard,
  type HomeBoardPick,
} from "./boards";

const aliceHome: HomeBoardPick = {
  id: "board-alice",
  name: "Alice home",
  scope: "personal",
  isActive: true,
  ownerUserId: "user-alice",
};
const bobHome: HomeBoardPick = {
  id: "board-bob",
  name: "Bob home",
  scope: "personal",
  isActive: true,
  ownerUserId: "user-bob",
};
const teamBoard: HomeBoardPick = {
  id: "board-team",
  name: "Team dashboard",
  scope: "org",
  isActive: true,
  ownerUserId: null,
};

describe("personal Home boards", () => {
  it("gives each member their own personal board, never someone else's", () => {
    const listed = [aliceHome, bobHome, teamBoard];
    expect(pickHomeBoard(listed, { userId: "user-alice" })?.id).toBe("board-alice");
    expect(pickHomeBoard(listed, { userId: "user-bob" })?.id).toBe("board-bob");
    expect(pickHomeBoard(listed, { userId: "user-alice" })?.ownerUserId).toBe("user-alice");
  });

  it("does not fall back to the team board when a member has no personal layout yet", () => {
    expect(pickHomeBoard([teamBoard], { userId: "user-alice" })).toBeNull();
    expect(pickHomeBoard([bobHome, teamBoard], { userId: "user-alice" })).toBeNull();
  });

  it("opens a team board only when that member explicitly picked it", () => {
    expect(pickHomeBoard([aliceHome, teamBoard], { userId: "user-alice", preferredId: "board-team" })?.id).toBe(
      "board-team",
    );
    expect(pickHomeBoard([aliceHome, teamBoard], { userId: "user-alice", preferredId: "missing" })?.id).toBe(
      "board-alice",
    );
  });

  it("ignores another member's personal board id even if it is preferred", () => {
    expect(pickHomeBoard([aliceHome, bobHome], { userId: "user-alice", preferredId: "board-bob" })?.id).toBe(
      "board-alice",
    );
  });

  it("scopes localStorage keys per user so teammates do not share a remembered board", () => {
    expect(boardStorageKey("org-1", "user-alice")).toBe("vantage.dashboard.board.org-1.user-alice");
    expect(boardStorageKey("org-1", "user-alice")).not.toBe(boardStorageKey("org-1", "user-bob"));
  });

  it("blocks scouts from writing the shared team board", () => {
    expect(canWriteOrgDashboard("scout")).toBe(false);
    expect(canWriteOrgDashboard("owner")).toBe(true);
  });
});

describe("dashboard drag and drop", () => {
  it("moves a widget's x/y when the grid reports a drag", () => {
    const nextMatch = DEFAULT_DASHBOARD_LAYOUT.find((item) => item.type === "next_match")!;
    const dragged = applyGridDrag(
      DEFAULT_DASHBOARD_LAYOUT,
      DEFAULT_DASHBOARD_LAYOUT.map((item) =>
        item.i === nextMatch.i ? { i: item.i, x: 6, y: 4, w: item.w, h: item.h } : item,
      ),
      12,
    );
    const moved = dragged.find((item) => item.type === "next_match");
    expect(moved?.x).toBe(6);
    expect(moved?.y).toBe(4);
    expect(dragged.find((item) => item.type === "competition_snapshot")?.x).toBe(6);
  });

  it("scales a phone-grid drag back onto the saved 12-column board", () => {
    const nextMatch = DEFAULT_DASHBOARD_LAYOUT.find((item) => item.type === "next_match")!;
    const dragged = applyGridDrag(DEFAULT_DASHBOARD_LAYOUT, [{ i: nextMatch.i, x: 2, y: 4, w: 2, h: 4 }], 4);
    expect(dragged.find((item) => item.type === "next_match")?.x).toBe(6);
    expect(dragged.find((item) => item.type === "next_match")?.w).toBe(6);
  });

  it("drops a new widget into a free slot without overlapping existing cards", () => {
    const result = dropWidgetOntoLayout(DEFAULT_DASHBOARD_LAYOUT, "notifications", { now: 42 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.some((item) => item.type === "notifications" && item.i === "w-notifications-42")).toBe(true);
    for (let i = 0; i < result.layout.length; i += 1) {
      for (let j = i + 1; j < result.layout.length; j += 1) {
        expect(dashboardRectsOverlap(result.layout[i]!, result.layout[j]!)).toBe(false);
      }
    }
  });

  it("places a palette drop on the pointed-at cell", () => {
    const result = dropWidgetOntoLayout(DEFAULT_DASHBOARD_LAYOUT, "team_todos", {
      drop: { x: 0, y: 12 },
      displayCols: 12,
      now: 7,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.layout.find((item) => item.type === "team_todos");
    expect(added?.x).toBe(0);
    expect(added?.y).toBe(12);
  });

  it("refuses a second copy of a widget that is already on the board", () => {
    expect(dropWidgetOntoLayout(DEFAULT_DASHBOARD_LAYOUT, "next_match")).toEqual({
      ok: false,
      error: "That widget is already on the board.",
    });
  });
});
