import { describe, expect, it } from "vitest";
import {
  TOOL_CHECKOUT_RELATED_INCLUDE,
  classifyToolCheckoutShell,
  formatToolCheckoutMetric,
  toolCheckoutNextActions,
  toolCheckoutRelatedLinks,
  toolCheckoutShellCopy,
  shouldShowToolCheckoutSummaryTiles,
} from "./tool-checkout-related";

describe("toolCheckoutRelatedLinks", () => {
  it("builds Equipment / Training / Checklist / Safety cross-links", () => {
    const links = toolCheckoutRelatedLinks("org-1", {
      include: [...TOOL_CHECKOUT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual([
      "equipment-maintenance",
      "training",
      "checklist-library",
      "safety-training",
    ]);
    expect(links.find((l) => l.id === "equipment-maintenance")?.href).toBe(
      "/team?tab=equipment-maintenance&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(toolCheckoutRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("toolCheckoutNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = toolCheckoutNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "equipment")).toBe(true);
  });

  it("points empty boards at add-tool", () => {
    const actions = toolCheckoutNextActions({
      orgId: "org-1",
      shell: "empty",
      toolCount: 0,
    });
    expect(actions[0]?.id).toBe("add-tool");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize overdue without DEMO metrics", () => {
    const actions = toolCheckoutNextActions({
      orgId: "org-1",
      shell: "ready",
      toolCount: 4,
      overdueCount: 2,
    });
    expect(actions[0]?.id).toBe("overdue");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyToolCheckoutShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyToolCheckoutShell({ loading: true })).toBe("loading");
    expect(classifyToolCheckoutShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyToolCheckoutShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyToolCheckoutShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        toolCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyToolCheckoutShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        toolCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatToolCheckoutMetric(4, true)).toBe("4");
    expect(shouldShowToolCheckoutSummaryTiles(0)).toBe(false);
    expect(shouldShowToolCheckoutSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO loan ledgers", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = toolCheckoutShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
