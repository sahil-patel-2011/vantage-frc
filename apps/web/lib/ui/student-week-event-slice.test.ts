import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eventDayRelatedLinks, eventDayShellCopy, EVENT_DAY_RELATED_INCLUDE } from "../command/event-day-related";
import { hoursSelfViewNextActions, hoursSelfViewShellCopy } from "../hours-self-view/hours-self-view-related";
import { hoursShellCopy } from "../hours/hours-related";
import { inspectionCopilotShellCopy } from "../inspection-copilot/inspection-copilot-related";
import { hubById, hubFeaturedMoreTabs } from "../nav/hubs";
import { myDayNextActions } from "../my-day-related";
import { pickDeskNextActions, pickDeskShellCopy } from "../strategy/pick-desk-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

const THIS_SLICE = [
  "lib/command/event-day-related.ts",
  "app/command/command-chrome.tsx",
  "app/packing/packing-client.tsx",
  "app/match-checklist/match-checklist-client.tsx",
  "app/tool-checkout/tool-checkout-client.tsx",
  "app/inspection-copilot/inspection-copilot-client.tsx",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/hours-self-view/hours-self-view-related.ts",
  "app/hours-self-view/hours-self-view-client.tsx",
  "lib/hours/hours-related.ts",
  "lib/strategy/pick-desk-related.ts",
  "app/strategy/pick-list-workbench.tsx",
  "lib/nav/hubs.ts",
] as const;

describe("student-week Event day / Hours / Pick desk slice", () => {
  it("Event Day related strip is packing, match checklist, tool checkout, inspection", () => {
    expect([...EVENT_DAY_RELATED_INCLUDE]).toEqual([
      "packing",
      "match-checklist",
      "tool-checkout",
      "inspection",
    ]);
    const links = eventDayRelatedLinks("org-1", { include: [...EVENT_DAY_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual([
      "packing",
      "match-checklist",
      "tool-checkout",
      "inspection",
    ]);
    expect(eventDayShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(eventDayShellCopy("setup").description);
  });

  it("features Packing and Pick desk on the Competition hub", () => {
    expect(hubFeaturedMoreTabs(hubById("competition")).map((tab) => tab.id)).toEqual([
      "briefing",
      "video-analysis",
      "packing",
      "alliance-selection-desk",
      "picks",
    ]);
    expect(hubById("competition").tabs.find((tab) => tab.id === "picks")?.label).toBe("Pick desk");
    expect(hubById("team").tabs.find((tab) => tab.id === "hours-self-view")?.featured).toBe(true);
  });

  it("My Hours empty is Clock in; setup is Needs setup without invented totals", () => {
    expect(hoursSelfViewShellCopy("setup").badge).toBe("Needs setup");
    expect(hoursSelfViewShellCopy("empty").title).toBe("Clock in to start your record");
    const empty = hoursSelfViewNextActions({ orgId: "org-1", shell: "empty", entryCount: 0 });
    expect(empty[0]?.label).toBe("Clock in");
    expect(empty).toHaveLength(1);
    expect(hoursShellCopy("setup").badge).toBe("Needs setup");
    const client = readFileSync(join(WEB, "app/hours-self-view/hours-self-view-client.tsx"), "utf8");
    expect(client).toMatch(/action: "clock_in"/);
    expect(client).toMatch(/action: "clock_out"/);
    expect(client).toMatch(/failureStatus: errorStatus/);
    expect(client).not.toMatch(/hour_logs/);
    expect(client).not.toMatch(/Open Attendance/);
  });

  it("My Day ready offers Clock in to My Hours after Scout this match", () => {
    const ready = myDayNextActions({ orgId: "org-1", shell: "ready" });
    expect(ready[0]?.label).toBe("Scout this match");
    expect(ready.find((action) => action.id === "hours")?.href).toBe("/hours-self-view?orgId=org-1");
    expect(ready.find((action) => action.id === "hours")?.label).toBe("Clock in");
  });

  it("Pick desk uses rank/pick/lock language and has gold last-snapshot", () => {
    expect(pickDeskShellCopy("setup").badge).toBe("Needs setup");
    expect(pickDeskShellCopy("empty").title).toBe("No teams to rank yet");
    expect(pickDeskShellCopy("ready").title).toBe("Rank, pick, and lock");
    expectPlainCopy(pickDeskShellCopy("empty").description);
    const empty = pickDeskNextActions({ orgId: "org-1", shell: "empty", candidateCount: 0 });
    expect(empty[0]?.label).toBe("Open Scouting");
    expect(JSON.stringify(empty)).not.toMatch(/Blue Alliance|TBA|EPA/);
    const workbench = readFileSync(join(WEB, "app/strategy/pick-list-workbench.tsx"), "utf8");
    expect(workbench).toMatch(/putFeatureSnapshot\("pick-desk"/);
    expect(workbench).toMatch(/AbortSignal\.timeout\(FEATURE_API_TIMEOUT_MS\)/);
    expect(workbench).toMatch(/response\.status === 401 \|\| response\.status === 403/);
    expect(workbench).toMatch(/Lock this list/);
    expect(workbench).not.toMatch(/\bEPA\b/);
    expect(workbench).not.toMatch(/The Blue Alliance/);
    expect(workbench).not.toMatch(/Sync event metrics/);
  });

  it("Inspection setup is Needs setup; packing/checklist/tool checkout keep last snapshot", () => {
    expect(inspectionCopilotShellCopy("setup").badge).toBe("Needs setup");
    const packing = readFileSync(join(WEB, "app/packing/packing-client.tsx"), "utf8");
    expect(packing).toMatch(/if \(!view\)/);
    expect(packing).toMatch(/putFeatureSnapshot\("packing"/);
    expect(packing).toMatch(/clearFeatureSnapshot\("packing"/);
    expect(packing).toMatch(/badge="Needs setup"/);
    const checklist = readFileSync(join(WEB, "app/match-checklist/match-checklist-client.tsx"), "utf8");
    expect(checklist).toMatch(/if \(!view\)/);
    expect(checklist).toMatch(/clearFeatureSnapshot\("match-checklist"/);
    expect(checklist).not.toMatch(/\bTBA\b/);
    const tools = readFileSync(join(WEB, "app/tool-checkout/tool-checkout-client.tsx"), "utf8");
    expect(tools).toMatch(/clearFeatureSnapshot\("tool-checkout"/);
  });

  it("does not print leftover Setup required / VANTAGE / OAuth on this slice", () => {
    for (const rel of THIS_SLICE) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Connect TBA/);
      expect(src, rel).not.toMatch(/Connect Onshape with OAuth/);
    }
  });
});
