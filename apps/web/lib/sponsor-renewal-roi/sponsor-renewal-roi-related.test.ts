import { describe, expect, it } from "vitest";
import {
  SPONSOR_RENEWAL_ROI_RELATED_INCLUDE,
  classifySponsorRenewalRoiShell,
  formatSponsorRenewalRoiMetric,
  shouldShowSponsorRenewalRoiSummaryTiles,
  sponsorRenewalRoiNextActions,
  sponsorRenewalRoiRelatedLinks,
  sponsorRenewalRoiShellCopy,
} from "./sponsor-renewal-roi-related";

describe("sponsorRenewalRoiRelatedLinks", () => {
  it("builds CRM / Suite / Impact cross-links", () => {
    const links = sponsorRenewalRoiRelatedLinks("org-1", {
      include: [...SPONSOR_RENEWAL_ROI_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["sponsors", "sponsor-suite", "impact"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe(
      "/business?tab=sponsors&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(sponsorRenewalRoiRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("sponsorRenewalRoiNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = sponsorRenewalRoiNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
  });

  it("setup with org points at Sponsor CRM", () => {
    const actions = sponsorRenewalRoiNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("sponsors");
    expect(actions[0]?.href).toBe("/business?tab=sponsors&orgId=org-1");
  });

  it("ready boards prioritize scored sponsors without DEMO metrics", () => {
    const actions = sponsorRenewalRoiNextActions({
      orgId: "org-1",
      shell: "ready",
      sponsorCount: 3,
      scoredCount: 2,
    });
    expect(actions[0]?.id).toBe("review-scores");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySponsorRenewalRoiShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifySponsorRenewalRoiShell({ loading: true })).toBe("loading");
    expect(classifySponsorRenewalRoiShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifySponsorRenewalRoiShell({
        loading: false,
        status: "setup_required",
        orgId: "org-1",
      }),
    ).toBe("setup");
    expect(
      classifySponsorRenewalRoiShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sponsorCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySponsorRenewalRoiShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sponsorCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatSponsorRenewalRoiMetric(3, true)).toBe("3");
    expect(shouldShowSponsorRenewalRoiSummaryTiles(0)).toBe(false);
  });

  it("copy never invents DEMO churn scores", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = sponsorRenewalRoiShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
