import { describe, expect, it } from "vitest";
import {
  STRATEGY_RELATED_INCLUDE,
  classifyStrategyShell,
  formatStrategyMetric,
  shouldShowStrategyWinRate,
  strategyNextActions,
  strategyRelatedLinks,
  strategyShellCopy,
  strategyShellSetupSteps,
} from "./strategy-related";

describe("strategyRelatedLinks", () => {
  it("builds Pick desk / Scouting / Event Day via hubHref / withOrgHref", () => {
    const links = strategyRelatedLinks("org-1", {
      include: [...STRATEGY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["pick-desk", "scouting", "command"]);
    expect(links.find((l) => l.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(strategyRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("strategyShellSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO win rates", () => {
    const steps = strategyShellSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/DEMO/i.test(s.detail))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Strategy Soft-UI metrics", () => {
  it("formats real counts only and hides win rates until live", () => {
    expect(formatStrategyMetric(3, true)).toBe("3");
    expect(formatStrategyMetric(0, false)).toBe("…");
    expect(formatStrategyMetric(-1, true)).toBe("0");
    expect(shouldShowStrategyWinRate("live")).toBe(true);
    expect(shouldShowStrategyWinRate("empty")).toBe(false);
    expect(shouldShowStrategyWinRate("setup_required")).toBe(false);
    expect(shouldShowStrategyWinRate(null)).toBe(false);
  });
});

describe("classifyStrategyShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO win rates", () => {
    expect(classifyStrategyShell({ loading: true })).toBe("loading");
    expect(classifyStrategyShell({ fetchFailed: true })).toBe("error");
    expect(classifyStrategyShell({ status: "setup_required", orgId: null })).toBe("setup");
    expect(classifyStrategyShell({ status: "empty", orgId: "org-1" })).toBe("empty");
    expect(classifyStrategyShell({ status: "live", orgId: "org-1" })).toBe("ready");
  });
});

describe("strategyShellCopy", () => {
  it("refuses invented DEMO win rates in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = strategyShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(strategyShellCopy("empty").badge).toBe("No prediction yet");
    expect(strategyShellCopy("empty").description).not.toMatch(/DEMO/i);
    expect(strategyShellCopy("empty").description).not.toMatch(/\d+%/);
    expect(strategyShellCopy("setup").badge).toBe("Needs setup");
    expect(strategyShellCopy("ready").description).not.toMatch(/DEMO/i);
  });
});

describe("strategyNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = strategyNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["pick-desk", "scouting", "command"]),
    );
  });

  it("points empty boards at Pick desk / Scouting / Event Day — never DEMO win rates", () => {
    const actions = strategyNextActions({
      orgId: "org-1",
      shell: "empty",
      eventKey: "2026casj",
      tbaConfigured: true,
      hasMetrics: false,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["pick-desk", "scouting", "command"]),
    );
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
    expect(actions.every((a) => !/DEMO/i.test(a.detail))).toBe(true);
    expect(actions.find((a) => a.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("ready boards prioritize Pick desk", () => {
    const actions = strategyNextActions({ orgId: "org-1", shell: "ready" });
    expect(actions[0]?.id).toBe("pick-desk");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["pick-desk", "scouting", "command"]),
    );
  });
});
