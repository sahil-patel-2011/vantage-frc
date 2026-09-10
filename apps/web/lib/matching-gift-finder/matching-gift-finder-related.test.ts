import { describe, expect, it } from "vitest";
import {
  MATCHING_GIFT_FINDER_RELATED_INCLUDE,
  classifyMatchingGiftFinderShell,
  formatMatchingGiftFinderMetric,
  matchingGiftFinderNextActions,
  matchingGiftFinderRelatedLinks,
  matchingGiftFinderShellCopy,
  shouldShowMatchingGiftFinderSummaryTiles,
} from "./matching-gift-finder-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("matchingGiftFinderRelatedLinks", () => {
  it("builds CRM / Renewal / Impact cross-links", () => {
    const links = matchingGiftFinderRelatedLinks("org-1", {
      include: [...MATCHING_GIFT_FINDER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["sponsors", "sponsor-renewal-roi", "impact"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe(
      "/business?tab=sponsors&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(matchingGiftFinderRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("matchingGiftFinderNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchingGiftFinderNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
  });

  it("empty boards prioritize adding contacts without DEMO metrics", () => {
    const actions = matchingGiftFinderNextActions({
      orgId: "org-1",
      shell: "empty",
      contactCount: 0,
    });
    expect(actions[0]?.href).toBe("#matching-gift-contacts");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize real matches", () => {
    const actions = matchingGiftFinderNextActions({
      orgId: "org-1",
      shell: "ready",
      contactCount: 4,
      matchCount: 2,
    });
    expect(actions[0]?.id).toBe("review-matches");
    expect(actions[0]?.href).toBe("#matching-gift-matches");
  });
});

describe("classifyMatchingGiftFinderShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyMatchingGiftFinderShell({ loading: true })).toBe("loading");
    expect(classifyMatchingGiftFinderShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyMatchingGiftFinderShell({
        loading: false,
        status: "setup_required",
        orgId: "org-1",
      }),
    ).toBe("setup");
    expect(
      classifyMatchingGiftFinderShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        contactCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMatchingGiftFinderShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        contactCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatMatchingGiftFinderMetric(3, true)).toBe("3");
    expect(shouldShowMatchingGiftFinderSummaryTiles(0)).toBe(false);
  });

  it("copy never invents DEMO matches", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = matchingGiftFinderShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
