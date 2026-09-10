import { describe, expect, it } from "vitest";
import {
  SPONSOR_SUITE_RELATED_INCLUDE,
  classifySponsorSuiteShell,
  formatSponsorSuiteMetric,
  shouldShowSponsorSuiteSummaryTiles,
  sponsorSuiteNextActions,
  sponsorSuiteRelatedLinks,
  sponsorSuiteShellCopy,
} from "./sponsor-suite-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("sponsorSuiteRelatedLinks", () => {
  it("builds Sponsor CRM / Sponsorship / Sponsor Wall cross-links", () => {
    const links = sponsorSuiteRelatedLinks("org-1", {
      include: [...SPONSOR_SUITE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["sponsors", "sponsorship", "sponsor-wall"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "sponsor-wall")?.href).toBe(
      "/business?tab=sponsor-wall&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(sponsorSuiteRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("sponsorSuiteNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = sponsorSuiteNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
  });

  it("points empty shells at Sponsor CRM", () => {
    const actions = sponsorSuiteNextActions({
      orgId: "org-1",
      shell: "empty",
      sponsorCount: 0,
    });
    expect(actions[0]?.id).toBe("sponsors");
    expect(actions[0]?.href).toContain("tab=sponsors");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize metered deck generation without DEMO metrics", () => {
    const actions = sponsorSuiteNextActions({
      orgId: "org-1",
      shell: "ready",
      sponsorCount: 3,
      deckCount: 1,
    });
    expect(actions[0]?.id).toBe("deck");
    expect(actions[0]?.detail).toMatch(/metered/i);
  });
});

describe("classifySponsorSuiteShell", () => {
  it("classifies loading / setup / empty / ready without DEMO counts", () => {
    expect(classifySponsorSuiteShell({ loading: true })).toBe("loading");
    expect(classifySponsorSuiteShell({ loading: false, orgId: null })).toBe("setup");
    expect(
      classifySponsorSuiteShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sponsorCount: 0,
        deckCount: 0,
        reminderCount: 0,
        roiReportCount: 0,
        hasGoal: false,
      }),
    ).toBe("empty");
    expect(
      classifySponsorSuiteShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sponsorCount: 2,
        deckCount: 0,
        reminderCount: 0,
        roiReportCount: 0,
        hasGoal: false,
      }),
    ).toBe("ready");
  });
});

describe("sponsorSuiteShellCopy + format helpers", () => {
  it("refuses invented DEMO fundraising metrics", () => {
    expectPlainCopy(sponsorSuiteShellCopy("empty").description);
    expect(formatSponsorSuiteMetric(4, true)).toBe("4");
    expect(
      shouldShowSponsorSuiteSummaryTiles({
        sponsorCount: 0,
        deckCount: 0,
        reminderCount: 0,
        hasGoal: false,
      }),
    ).toBe(false);
    expect(
      shouldShowSponsorSuiteSummaryTiles({
        sponsorCount: 1,
        deckCount: 0,
        reminderCount: 0,
        hasGoal: false,
      }),
    ).toBe(true);
  });
});
