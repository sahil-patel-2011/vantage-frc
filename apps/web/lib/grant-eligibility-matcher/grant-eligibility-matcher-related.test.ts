import { describe, expect, it } from "vitest";
import {
  GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE,
  classifyGrantEligibilityMatcherShell,
  formatGrantEligibilityMatcherMetric,
  grantEligibilityMatcherNextActions,
  grantEligibilityMatcherRelatedLinks,
  grantEligibilityMatcherShellCopy,
  shouldShowGrantEligibilityMatcherSummaryTiles,
} from "./grant-eligibility-matcher-related";

describe("grantEligibilityMatcherRelatedLinks", () => {
  it("builds Grants / Report / Impact cross-links", () => {
    const links = grantEligibilityMatcherRelatedLinks("org-1", {
      include: [...GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["grants", "grant-report", "impact"]);
    expect(links.find((l) => l.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(grantEligibilityMatcherRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("grantEligibilityMatcherNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = grantEligibilityMatcherNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "grants")).toBe(true);
  });

  it("points empty boards at profile + Grants", () => {
    const actions = grantEligibilityMatcherNextActions({
      orgId: "org-1",
      shell: "empty",
      eligibleCount: 0,
    });
    expect(actions[0]?.href).toBe("#grant-eligibility-profile");
    expect(actions.some((a) => a.id === "grants")).toBe(true);
  });

  it("ready boards prioritize deadlines without DEMO metrics", () => {
    const actions = grantEligibilityMatcherNextActions({
      orgId: "org-1",
      shell: "ready",
      eligibleCount: 4,
      deadlineCount: 2,
    });
    expect(actions[0]?.id).toBe("deadline-radar");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyGrantEligibilityMatcherShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyGrantEligibilityMatcherShell({ loading: true })).toBe("loading");
    expect(classifyGrantEligibilityMatcherShell({ loading: false, fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyGrantEligibilityMatcherShell({
        loading: false,
        status: "setup_required",
        orgId: "org-1",
      }),
    ).toBe("setup");
    expect(
      classifyGrantEligibilityMatcherShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        eligibleCount: 0,
        catalogSize: 5,
      }),
    ).toBe("empty");
    expect(
      classifyGrantEligibilityMatcherShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        eligibleCount: 2,
        catalogSize: 5,
      }),
    ).toBe("ready");
  });

  it("formats metrics and shows tiles when catalog exists", () => {
    expect(formatGrantEligibilityMatcherMetric(2, true)).toBe("2");
    expect(shouldShowGrantEligibilityMatcherSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowGrantEligibilityMatcherSummaryTiles(0, 3)).toBe(true);
  });

  it("copy never invents DEMO grant dollars", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = grantEligibilityMatcherShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
