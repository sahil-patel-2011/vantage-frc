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
    ).toEqual(["next_match", "alerts"]);
  });

  it("keeps setup widgets while the workspace is still configuring", () => {
    expect(
      snapshotPollWidgetTypes([{ type: "onboarding_checklist" }, { type: "next_match" }], { shell: "setup" }),
    ).toEqual(["onboarding_checklist", "next_match"]);
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
