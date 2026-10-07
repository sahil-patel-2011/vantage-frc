import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoutingCoverageCard } from "./scouting-coverage";
import { WidgetsLoadedContext } from "./widgets-loaded";
import { BudgetPartsLive } from "./extra-cards";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";

function render(payload?: WidgetPayload, loaded = true) {
  return renderToStaticMarkup(createElement(WidgetsLoadedContext.Provider, { value: loaded }, createElement(ScoutingCoverageCard, { orgId: "team-one", payload })));
}
const payload = (status: WidgetPayload["status"], data: Record<string, unknown> = {}): WidgetPayload =>
  ({ type: "scouting_coverage", status, data, updatedAt: "2026-10-06T12:00:00Z" });
describe("honest Home widget states", () => {
  it("waits for data before offering practice or claiming an empty event", () => {
    const html = render(undefined, false);
    expect(html).toContain("Loading scouting coverage");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("mode=free");
  });
  it("offers a data refresh when coverage is unavailable", () => {
    const html = render({ ...payload("unavailable"), message: "Coverage is unavailable." });
    expect(html).toContain("Coverage is unavailable.");
    expect(html).toContain("Refresh data");
    expect(html).not.toContain("Start with a pit visit");
    expect(render()).toContain("Refresh data");
  });
  it("shows observed counts against the actual schedule and keeps the team on actions", () => {
    const html = render(payload("live", { scheduledTeams: 40, pitReports: 0, matchSlots: 120, matchReports: 18, reports: 20 }));
    expect(html).toContain('value="0" max="40"');
    expect(html).toContain("0 / 40");
    expect(html).toContain("18 / 120");
    expect(html).toContain("20 match reports");
    expect(html).toContain("orgId=team-one");
    expect(html).not.toContain("mode=free");
    expect(render(payload("live", { scheduledTeams: 0 }))).toContain("No event schedule is available yet");
  });
  it("distinguishes a zero budget from an unknown budget", () => {
    for (const value of [null, undefined, "", " ", false, [], {}]) {
      const html = renderToStaticMarkup(createElement(BudgetPartsLive, { data: { remainingUsd: value } }));
      expect(html).toContain("—"); expect(html).not.toContain("$0");
    }
    for (const value of [0, "0"]) expect(renderToStaticMarkup(createElement(BudgetPartsLive, { data: { remainingUsd: value } }))).toContain("$0");
  });
});
