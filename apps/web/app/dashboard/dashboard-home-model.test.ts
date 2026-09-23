import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_LAYOUT, WIDGET_CATALOG } from "../../lib/dashboard/catalog";
import {
  dashboardBoardLists,
  dashboardPaletteRows,
  homeHeaderDetail,
  homeNowAction,
  homeNowFromWidgets,
  nextEventToday,
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
    })).toBe("");
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
      tbaConfigured: false,
      setupRequired: false,
      eventName: "Pacific Practice",
    })).toBe("");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: true,
      eventName: null,
      // Silent on purpose: the SETUP card below says this and gives the
      // button. Two instructions were the first two things on the page.
    })).toBe("");
    expect(homeHeaderDetail({
      meLoaded: true,
      orgId: "org-1",
      tbaConfigured: true,
      setupRequired: false,
      eventName: "Houston",
      // Silent: the event row directly below the hero is these same words with
      // a pin icon and a link on it, so returning the name here put the event
      // on screen twice, one line apart.
    })).toBe("");
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
      cta: "Open My Hours",
    });
    expect(homeNowAction({ orgId: "org-1", openTodos: 3 }).title).toBe("3 things on your list");
    expect(homeNowAction({ orgId: "org-1" }).title).toBe("Nothing you have to do right now");
    expect(homeNowAction({ orgId: "org-1" }).quiet).toBe(true);
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
    expect(rows).toHaveLength(WIDGET_CATALOG.filter((entry) => entry.type !== "pit_youtube").length);
    expect(rows.some((row) => row.entry.type === "pit_youtube")).toBe(false);
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

describe("before the widgets have arrived", () => {
  it("says it is still working it out, not that there is nothing to do", () => {
    // Every check in the card falls through when the widgets are empty, so an
    // unloaded board used to read "Nothing you have to do right now" — the one
    // answer that tells a student to stop looking — and then replace it with
    // the real one a moment later.
    const card = homeNowFromWidgets({ orgId: "org-1", widgets: {}, loaded: false });
    expect(card.title).toBe("Working out what is next");
    expect(card.title).not.toMatch(/Nothing you have to do/);
  });

  it("says there is nothing only once it has looked", () => {
    const card = homeNowFromWidgets({ orgId: "org-1", widgets: {}, loaded: true });
    expect(card.title).toBe("Nothing you have to do right now");
  });

  it("treats a missing flag as loaded, so nothing that does not pass it changes", () => {
    const card = homeNowFromWidgets({ orgId: "org-1", widgets: {} });
    expect(card.title).toBe("Nothing you have to do right now");
  });

  it("still asks for a team before anything else", () => {
    // No org is not a loading state; it is an answer.
    const card = homeNowFromWidgets({ orgId: "", widgets: {}, loaded: false });
    expect(card.title).toBe("Choose your team");
  });
});

describe("what the calendar puts on the card", () => {
  const at = (hour: number, minute = 0, dayOffset = 0) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute).toISOString();
  };
  const NOON = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
  };

  it("says what is on tonight", () => {
    expect(nextEventToday({ items: [{ title: "Build night", startsAt: at(18) }] }, NOON())).toEqual({
      title: "Build night",
      whenLabel: "Today at 6 PM",
    });
  });

  it("keeps the minutes when there are any", () => {
    expect(
      nextEventToday({ items: [{ title: "Standup", startsAt: at(18, 30) }] }, NOON())?.whenLabel,
    ).toBe("Today at 6:30 PM");
  });

  it("ignores what already happened", () => {
    // A practice that finished at ten is not something to do at noon.
    expect(nextEventToday({ items: [{ title: "Morning", startsAt: at(9) }] }, NOON())).toBeNull();
  });

  it("ignores the rest of the week", () => {
    // The widget loads seven days because its own card shows seven days.
    // "Practice tonight" and "practice on Thursday" are different claims.
    expect(nextEventToday({ items: [{ title: "Thursday", startsAt: at(18, 0, 2) }] }, NOON())).toBeNull();
  });

  it("takes the soonest one still ahead", () => {
    const picked = nextEventToday(
      {
        items: [
          { title: "Late", startsAt: at(20) },
          { title: "Early", startsAt: at(15) },
          { title: "Gone", startsAt: at(8) },
        ],
      },
      NOON(),
    );
    expect(picked?.title).toBe("Early");
  });

  it("is null for nonsense rather than throwing", () => {
    expect(nextEventToday(undefined, NOON())).toBeNull();
    expect(nextEventToday({ items: [] }, NOON())).toBeNull();
    expect(nextEventToday({ items: [{ title: "x", startsAt: "soon" }] }, NOON())).toBeNull();
    expect(nextEventToday({ items: [{ startsAt: at(18) }] }, NOON())).toBeNull();
  });

  it("sits below a match and a shift, and above the todo list", () => {
    const event = { title: "Build night", whenLabel: "Today at 6 PM" };
    // A match starting beats it.
    expect(homeNowAction({ orgId: "o", nextMatchLabel: "Qual 12", nextEventToday: event }).title).toBe(
      "You’re up next",
    );
    // Being in the shop already beats it.
    expect(homeNowAction({ orgId: "o", clockedIn: true, nextEventToday: event }).cta).toBe(
      "Open My Hours",
    );
    // A list of tasks does not.
    expect(homeNowAction({ orgId: "o", openTodos: 3, nextEventToday: event }).title).toBe("Build night");
  });

  it("falls through to the quiet state when nothing is on", () => {
    expect(homeNowAction({ orgId: "o", nextEventToday: null }).title).toBe(
      "Nothing you have to do right now",
    );
  });
});

describe("home now: scouting duty", () => {
  const scoutDuty = { matchKey: "2026casj_qm34", teamKey: "frc148", matchLabel: "Q34" };

  it("sends a scout straight to their robot's form, after the team's own match", () => {
    const action = homeNowAction({ orgId: "org-1", scoutDuty, dutyTitle: "Pit crew" });
    expect(action.title).toBe("You’re scouting next");
    expect(action.detail).toBe("148 in Q34");
    expect(action.href).toBe("/scout/entry?matchKey=2026casj_qm34&teamKey=frc148");
    expect(action.quiet).toBeUndefined();
    expect(homeNowAction({ orgId: "org-1", scoutDuty, nextMatchLabel: "qm 33" }).title).toBe("You’re up next");
  });

  it("reads the duty from the my_day widget", () => {
    const action = homeNowFromWidgets({
      orgId: "org-1",
      widgets: { a: { type: "my_day", data: { scoutDuty } } },
    });
    expect(action.cta).toBe("Scout 148");
  });
});
