import { describe, expect, it } from "vitest";
import {
  SPONSOR_WALL_RELATED_INCLUDE,
  classifySponsorWallShell,
  formatSponsorWallMetric,
  sponsorWallNextActions,
  sponsorWallRelatedLinks,
  sponsorWallShellCopy,
  shouldShowSponsorWallSummaryTiles,
} from "./sponsor-wall-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("sponsorWallRelatedLinks", () => {
  it("builds Sponsor CRM / Sponsorship / Sponsor Suite cross-links", () => {
    const links = sponsorWallRelatedLinks("org-1", {
      include: [...SPONSOR_WALL_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["sponsors", "sponsorship", "sponsor-suite"]);
    expect(links.find((l) => l.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(links.find((l) => l.id === "sponsorship")?.href).toBe(
      "/business?tab=sponsorship&orgId=org-1",
    );
    expect(links.find((l) => l.id === "sponsor-suite")?.href).toBe(
      "/business?tab=sponsor-suite&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = sponsorWallRelatedLinks("org-1", {
      active: "sponsors",
      include: ["sponsorship", "sponsor-suite"],
    });
    expect(links.map((l) => l.id)).toEqual(["sponsorship", "sponsor-suite"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(sponsorWallRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("sponsorWallNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = sponsorWallNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
    expect(actions.some((a) => a.id === "sponsorship")).toBe(true);
  });

  it("setup with org points at Workspace + CRM / Sponsorship", () => {
    const actions = sponsorWallNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
    expect(actions.some((a) => a.id === "sponsorship")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty shells at add + CRM / Sponsorship", () => {
    const actions = sponsorWallNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions[0]?.id).toBe("add");
    expect(actions[0]?.href).toBe("#sponsor-wall-add");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add", "sponsors", "sponsorship"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize add-more without DEMO metrics", () => {
    const actions = sponsorWallNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      publishedCount: 2,
    });
    expect(actions[0]?.id).toBe("add-more");
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
    expect(actions.some((a) => a.id === "sponsorship")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySponsorWallShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifySponsorWallShell({ loading: true })).toBe("loading");
    expect(classifySponsorWallShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifySponsorWallShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifySponsorWallShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifySponsorWallShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySponsorWallShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("sponsorWallShellCopy + format helpers", () => {
  it("refuses invented DEMO sponsor counts in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = sponsorWallShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(sponsorWallShellCopy("empty").description);
    expectPlainCopy(sponsorWallShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatSponsorWallMetric(null, false)).toBe("…");
    expect(formatSponsorWallMetric(3, true)).toBe("3");
    expect(shouldShowSponsorWallSummaryTiles(0)).toBe(false);
    expect(shouldShowSponsorWallSummaryTiles(1)).toBe(true);
  });
});
