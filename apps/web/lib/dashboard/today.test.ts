import { describe, expect, it } from "vitest";
import type { WidgetPayload } from "./snapshot";
import { buildTodayCards, formatEventWhen } from "./today";

const NOW = new Date("2026-03-14T15:00:00Z").getTime();

function widget(type: WidgetPayload["type"], status: WidgetPayload["status"], data?: Record<string, unknown>): WidgetPayload {
  return { type, status, updatedAt: new Date(NOW).toISOString(), data };
}

describe("today strip", () => {
  it("stays empty when nothing is live — never invents a card", () => {
    const cards = buildTodayCards(
      {
        orgId: "org",
        widgets: {
          next_match: widget("next_match", "setup_required"),
          team_todos: widget("team_todos", "empty", { open: 0, mineOpen: 0, overdue: 0 }),
          subteam_upcoming: widget("subteam_upcoming", "empty", { items: [] }),
        },
        unreadMessages: 0,
      },
      NOW,
    );
    expect(cards).toEqual([]);
  });

  it("leads with the next match and keeps the bumper cue", () => {
    const cards = buildTodayCards(
      {
        orgId: "org",
        widgets: {
          next_match: widget("next_match", "live", {
            compLevel: "qm",
            matchNumber: 31,
            scheduledTime: "2026-03-14T15:40:00Z",
            bumperCue: "Switch to RED bumpers",
            href: "/my-day?orgId=org",
          }),
        },
      },
      NOW,
    );
    expect(cards[0]).toMatchObject({ id: "next_match", title: "QM 31", detail: "Switch to RED bumpers", tone: "accent" });
    expect(cards[0]?.at).toBe("2026-03-14T15:40:00Z");
  });

  it("orders match, calendar, work, chat, then the sharpest role warning", () => {
    const cards = buildTodayCards(
      {
        orgId: "org",
        widgets: {
          next_match: widget("next_match", "live", { compLevel: "sf", matchNumber: 2, scheduledTime: "2026-03-14T16:00:00Z" }),
          subteam_upcoming: widget("subteam_upcoming", "live", {
            href: "/team/calendar?orgId=org",
            items: [
              { title: "Old", startsAt: "2026-03-13T15:00:00Z" },
              { title: "Drive practice", startsAt: "2026-03-14T22:00:00Z", subteamName: "Drive" },
            ],
          }),
          team_todos: widget("team_todos", "live", { open: 9, mineOpen: 2, overdue: 1 }),
        },
        unreadMessages: 4,
        homeStrip: [
          { key: "ok", label: "Lodging", detail: "fine", href: "/logistics", tone: "ok" },
          { key: "warn", label: "Needs assignment", detail: "3 open duties", href: "/duties?orgId=org", tone: "warn" },
        ],
      },
      NOW,
    );
    expect(cards.map((card) => card.id)).toEqual(["next_match", "next_event", "my_work", "chat", "focus"]);
    expect(cards[1]).toMatchObject({ label: "Drive · next", title: "Drive practice" });
    expect(cards[2]).toMatchObject({ title: "2 open tasks", detail: "1 overdue", tone: "warn" });
    expect(cards[3]?.title).toBe("4 unread");
    expect(cards[4]).toMatchObject({ label: "Needs assignment", title: "3 open duties" });
  });

  it("never exceeds five cards", () => {
    const cards = buildTodayCards(
      {
        orgId: "org",
        widgets: {
          next_match: widget("next_match", "live", { compLevel: "qm", matchNumber: 1 }),
          subteam_upcoming: widget("subteam_upcoming", "live", { items: [{ title: "Build", startsAt: "2026-03-15T00:00:00Z" }] }),
          team_todos: widget("team_todos", "live", { open: 1, mineOpen: 1, overdue: 0 }),
        },
        unreadMessages: 1,
        clockedInAt: "2026-03-14T13:00:00Z",
        homeStrip: [{ key: "w", label: "Gap", detail: "1 room open", href: "/logistics", tone: "warn" }],
      },
      NOW,
    );
    expect(cards).toHaveLength(5);
    expect(cards.some((card) => card.id === "focus")).toBe(false);
  });

  it("formats relative days without inventing a date", () => {
    expect(formatEventWhen(null)).toBeNull();
    expect(formatEventWhen("not a date")).toBeNull();
    expect(formatEventWhen("2026-03-14T22:00:00Z", NOW)?.startsWith("Today")).toBe(true);
    expect(formatEventWhen("2026-03-15T22:00:00Z", NOW)?.startsWith("Tomorrow")).toBe(true);
  });
});
