import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_LAYOUT, WIDGET_CATALOG } from "../../lib/dashboard/catalog";
import {
  dashboardBoardLists,
  dashboardPaletteRows,
  homeHeaderDetail,
  homeNowAction,
  homeNowFromWidgets,
} from "./dashboard-home-model";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

describe("homeHeaderDetail", () => {
  it("names the loading, no-team, event, and quiet-home states without engineering words", () => {
    expect(homeHeaderDetail({
      meLoaded: false,
      orgId: "",
      tbaConfigured: undefined,
      setupRequired: false,
      eventName: null,
    })).toBe("Loading your team…");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "",
      tbaConfigured: undefined,
      setupRequired: false,
      eventName: null,
    })).toBe("Choose your team to see your day.");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: false,
      setupRequired: false,
      eventName: null,
    })).toMatch(/next match, hours, and what to do now/);
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: false,
      setupRequired: false,
      eventName: null,
    })).not.toMatch(/Blue Alliance|TBA|EPA/);
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: true,
      eventName: null,
    })).toBe("Set the event you’re at so match times can show.");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: false,
      eventName: "Houston",
    })).toBe("Houston");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: false,
      eventName: null,
    })).toBe("Your week. Cards fill in as the team adds matches, hours, and duties.");
  });
});

describe("homeNowAction", () => {
  it("picks one next step from real data and stays calm when none exists", () => {
    expect(homeNowAction({ orgId: "" }).cta).toBe("Choose your team");
    expect(homeNowAction({ orgId: "org-1", nextMatchLabel: "Qual 12" })).toEqual({
      title: "You’re up next",
      detail: "Qual 12",
      href: "/my-day",
      cta: "Open My Day",
    });
    expect(homeNowAction({ orgId: "org-1", dutyTitle: "Battery cart" }).title).toBe("You’re on duty");
    expect(homeNowAction({ orgId: "org-1", clockedIn: true })).toEqual({
      title: "You’re in the shop",
      detail: "Your hours are still running.",
      href: "/hours-self-view",
      cta: "Open My hours",
    });
    expect(homeNowAction({ orgId: "org-1", openTodos: 3 }).title).toBe("3 things on your list");
    expect(homeNowAction({ orgId: "org-1" }).title).toBe("Nothing you have to do right now");
  });

  it("reads next match, duties, and todos from widget payloads without inventing counts", () => {
    const now = homeNowFromWidgets({
      orgId: "org-1",
      nextMatchData: { compLevel: "Qual", matchNumber: 7 },
      widgets: {
        a: { type: "my_day", data: { duties: [{ title: "Scout queue" }] } },
        b: { type: "team_todos", data: { open: 2 } },
      },
    });
    expect(now.title).toBe("You’re up next");
    expect(now.detail).toBe("Qual 7");
    expect(
      homeNowFromWidgets({
        orgId: "org-1",
        widgets: { a: { type: "hours_month", data: { openSession: true } } },
      }).title,
    ).toBe("You’re in the shop");
  });
});

describe("dashboardPaletteRows", () => {
  it("marks placed widgets and leaves the rest addable for an owner", () => {
    const rows = dashboardPaletteRows(DEFAULT_DASHBOARD_LAYOUT, "owner");
    expect(rows).toHaveLength(WIDGET_CATALOG.length);
    const placed = new Set(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.type));
    for (const row of rows) {
      if (placed.has(row.entry.type)) {
        expect(row.status).toBe("placed");
      } else {
        expect(row.status === "add" || row.status === "locked").toBe(true);
      }
    }
  });
});

describe("dashboardBoardLists", () => {
  it("keeps an unnamed active board in the switcher when it is not in the list", () => {
    const personal: BoardMeta = {
      id: "p1",
      name: "Mine",
      scope: "personal",
      isActive: false,
    };
    const board: BoardState = {
      id: "orphan",
      name: "Pinned",
      scope: "personal",
      layout: [],
    };
    const lists = dashboardBoardLists([personal], board);
    expect(lists.switcherBoards[0]?.id).toBe("orphan");
    expect(lists.switcherBoards[0]?.isActive).toBe(true);
    expect(lists.personalBoards).toEqual([personal]);
  });

  it("does not prepend the default home board", () => {
    const board: BoardState = {
      id: "d1",
      name: "Default home",
      scope: "personal",
      layout: [],
      isDefault: true,
    };
    const lists = dashboardBoardLists([], board);
    expect(lists.switcherBoards).toEqual([]);
  });
});
