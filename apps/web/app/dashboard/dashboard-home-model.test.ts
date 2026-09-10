import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_LAYOUT, WIDGET_CATALOG } from "../../lib/dashboard/catalog";
import {
  dashboardBoardLists,
  dashboardPaletteRows,
  homeHeaderDetail,
} from "./dashboard-home-model";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

describe("homeHeaderDetail", () => {
  it("names the loading, no-team, TBA, event, and quiet-home states", () => {
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
    })).toBe("Choose your team to load live data.");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: false,
      setupRequired: false,
      eventName: null,
    })).toMatch(/The Blue Alliance/);
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: true,
      eventName: null,
    })).toBe("Set your active event to load competition data.");
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
    })).toBe("Home — widgets appear when live data exists.");
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
