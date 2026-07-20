import { describe, expect, it } from "vitest";
import {
  FIELD_RESET_TIMER_RELATED_INCLUDE,
  classifyFieldResetTimerShell,
  formatFieldResetTimerMetric,
  fieldResetTimerNextActions,
  fieldResetTimerRelatedLinks,
  fieldResetTimerShellCopy,
  shouldShowFieldResetTimerSummaryTiles,
} from "./field-reset-timer-related";

describe("fieldResetTimerRelatedLinks", () => {
  it("builds Practice / Tryouts / Signals cross-links", () => {
    const links = fieldResetTimerRelatedLinks("org-1", {
      include: [...FIELD_RESET_TIMER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["practice", "driver-tryouts", "drive-team-signals"]);
    expect(links.find((l) => l.id === "practice")?.href).toBe("/team?tab=practice&orgId=org-1");
    expect(links.find((l) => l.id === "drive-team-signals")?.href).toBe(
      "/competition?tab=drive-team-signals&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(fieldResetTimerRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("fieldResetTimerNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = fieldResetTimerNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "practice")).toBe(true);
  });

  it("points empty boards at create-session", () => {
    const actions = fieldResetTimerNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
    });
    expect(actions[0]?.id).toBe("create-session");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize cycles without DEMO metrics", () => {
    const actions = fieldResetTimerNextActions({
      orgId: "org-1",
      shell: "ready",
      sessionCount: 2,
      cycleCount: 5,
    });
    expect(actions[0]?.id).toBe("review-cycles");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyFieldResetTimerShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyFieldResetTimerShell({ loading: true })).toBe("loading");
    expect(classifyFieldResetTimerShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyFieldResetTimerShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyFieldResetTimerShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sessionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyFieldResetTimerShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sessionCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatFieldResetTimerMetric(4, true)).toBe("4");
    expect(shouldShowFieldResetTimerSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowFieldResetTimerSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO drill times", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = fieldResetTimerShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
