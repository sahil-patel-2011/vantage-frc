import { describe, expect, it } from "vitest";
import {
  PICK_CLOCK_RELATED_INCLUDE,
  classifyPickClockShell,
  formatPickClockMetric,
  isPickClockQueueEmpty,
  pickClockNextActions,
  pickClockRelatedLinks,
  pickClockSetupSteps,
  pickClockShellCopy,
  shouldShowPickClockSummaryTiles,
} from "./pick-clock-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("pickClockRelatedLinks", () => {
  it("builds Strategy / Pick desk / Chemistry via hubHref / withOrgHref", () => {
    const links = pickClockRelatedLinks("org-1", {
      include: [...PICK_CLOCK_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "pick-desk", "chemistry"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(links.find((l) => l.id === "chemistry")?.href).toBe(
      "/competition?tab=chemistry&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(pickClockRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("pickClockSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO picks", () => {
    const steps = pickClockSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "chemistry")?.href).toBe(
      "/competition?tab=chemistry&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Pick clock Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatPickClockMetric(12, true)).toBe("12");
    expect(formatPickClockMetric(0, false)).toBe("…");
    expect(formatPickClockMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without available teams", () => {
    expect(shouldShowPickClockSummaryTiles(0)).toBe(false);
    expect(shouldShowPickClockSummaryTiles(3)).toBe(true);
  });

  it("treats missing recommendation or zero available as empty", () => {
    expect(isPickClockQueueEmpty({ hasRecommendation: false, availableCount: 5 })).toBe(true);
    expect(isPickClockQueueEmpty({ hasRecommendation: true, availableCount: 0 })).toBe(true);
    expect(isPickClockQueueEmpty({ hasRecommendation: true, availableCount: 2 })).toBe(false);
  });
});

describe("classifyPickClockShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO picks", () => {
    expect(classifyPickClockShell({ loading: true })).toBe("loading");
    expect(classifyPickClockShell({ fetchFailed: true, orgId: "o", eventKey: "e" })).toBe(
      "error",
    );
    expect(classifyPickClockShell({ status: "setup_required" })).toBe("setup");
    expect(classifyPickClockShell({ orgId: null, eventKey: "e", status: "ready" })).toBe("setup");
    expect(classifyPickClockShell({ orgId: "o", eventKey: null, status: "ready" })).toBe("setup");
    expect(
      classifyPickClockShell({
        orgId: "o",
        eventKey: "e",
        status: "ready",
        hasRecommendation: false,
        availableCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyPickClockShell({
        orgId: "o",
        eventKey: "e",
        status: "ready",
        hasRecommendation: true,
        availableCount: 4,
      }),
    ).toBe("ready");
  });
});

describe("pickClockShellCopy", () => {
  it("refuses invented DEMO picks in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = pickClockShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(pickClockShellCopy("empty").badge).toBe("No teams left to recommend");
    expectPlainCopy(pickClockShellCopy("empty").description);
    expect(pickClockShellCopy("setup").badge).toBe("Setup required");
    expectPlainCopy(pickClockShellCopy("ready").description);
  });
});

describe("pickClockNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = pickClockNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "chemistry")).toBe(true);
  });

  it("setup with org points at Strategy / Pick desk / Chemistry", () => {
    const actions = pickClockNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("command");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "chemistry")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Pick desk / Chemistry", () => {
    const actions = pickClockNextActions({
      orgId: "org-1",
      shell: "empty",
      hasRecommendation: false,
      availableCount: 0,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "pick-desk", "chemistry"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes clock without DEMO picks", () => {
    const actions = pickClockNextActions({
      orgId: "org-1",
      shell: "ready",
      hasRecommendation: true,
      availableCount: 7,
    });
    expect(actions[0]?.id).toBe("clock");
    expect(actions[0]?.detail).toMatch(/7 available/);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "chemistry")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
