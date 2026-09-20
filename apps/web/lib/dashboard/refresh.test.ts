import { describe, expect, it } from "vitest";
import {
  mergeDashboardContext,
  mergeDashboardWidgets,
  snapshotPollWidgetTypes,
  snapshotShouldLoadHomeStrip,
  snapshotWantsFullContext,
} from "./refresh";
import type { WidgetPayload } from "./snapshot";

describe("snapshotShouldLoadHomeStrip", () => {
  it("defaults to the full administrative snapshot when no widget filter is set", () => {
    expect(snapshotShouldLoadHomeStrip({})).toBe(true);
  });

  it("skips the home strip on filtered polls unless asked", () => {
    expect(snapshotShouldLoadHomeStrip({ widgetTypes: ["next_match"] })).toBe(false);
    expect(snapshotShouldLoadHomeStrip({ widgetTypes: ["next_match"], includeHomeStrip: true })).toBe(true);
    expect(snapshotShouldLoadHomeStrip({ includeHomeStrip: false })).toBe(false);
  });
});

describe("snapshotWantsFullContext", () => {
  it("only treats context=full as a slow refresh", () => {
    expect(snapshotWantsFullContext(new URL("https://vantage.local/api/dashboards?mode=snapshot"))).toBe(false);
    expect(snapshotWantsFullContext(new URL("https://vantage.local/api/dashboards?mode=snapshot&context=full"))).toBe(
      true,
    );
  });
});

describe("snapshotPollWidgetTypes", () => {
  /*
    `calendar_today` is in every result whether or not the board shows it.
    "What to do now" reads it to say "Build night — today at 6 PM", and that
    card is on Home for everybody, so the data it needs cannot depend on which
    widgets a team happens to have added.
  */
  it("drops onboarding and quick actions once Home is ready", () => {
    expect(
      snapshotPollWidgetTypes(
        [
          { type: "next_match" },
          { type: "onboarding_checklist" },
          { type: "quick_actions" },
          { type: "alerts" },
        ],
        { shell: "ready" },
      ),
    ).toEqual(["next_match", "alerts", "calendar_today"]);
  });

  it("asks for the calendar even when no calendar widget is on the board", () => {
    // The card that needs it is always there, so the data always loads.
    expect(snapshotPollWidgetTypes([{ type: "next_match" }], { shell: "ready" })).toContain(
      "calendar_today",
    );
    expect(snapshotPollWidgetTypes([], { shell: "ready" })).toEqual(["calendar_today"]);
  });

  it("does not ask for it twice when the board already shows it", () => {
    expect(
      snapshotPollWidgetTypes([{ type: "calendar_today" }], { shell: "ready" }),
    ).toEqual(["calendar_today"]);
  });

  it("keeps setup widgets while the team is still configuring", () => {
    expect(
      snapshotPollWidgetTypes([{ type: "onboarding_checklist" }, { type: "next_match" }], { shell: "setup" }),
    ).toEqual(["onboarding_checklist", "next_match", "calendar_today"]);
  });
});

describe("mergeDashboardContext", () => {
  it("keeps homeStrip and health when a slim poll omits them", () => {
    const current = { homeStrip: { items: [1] }, dataSourceHealth: { mode: "live" }, eventName: "Old" };
    expect(
      mergeDashboardContext(current, { eventName: "New Event" }),
    ).toEqual({
      homeStrip: { items: [1] },
      dataSourceHealth: { mode: "live" },
      eventName: "New Event",
    });
  });
});

describe("mergeDashboardWidgets", () => {
  it("overlays live payloads without dropping widgets the poll skipped", () => {
    const current = {
      next_match: { type: "next_match", status: "live", updatedAt: "1" } satisfies WidgetPayload,
      alerts: { type: "alerts", status: "empty", updatedAt: "1" } satisfies WidgetPayload,
    };
    expect(
      mergeDashboardWidgets(current, {
        next_match: { type: "next_match", status: "live", updatedAt: "2" },
      }),
    ).toEqual({
      next_match: { type: "next_match", status: "live", updatedAt: "2" },
      alerts: { type: "alerts", status: "empty", updatedAt: "1" },
    });
  });
});
