import { describe, expect, it } from "vitest";
import {
  MEDIA_KIT_RELATED_INCLUDE,
  classifyMediaKitShell,
  formatMediaKitMetric,
  mediaKitNextActions,
  mediaKitRelatedLinks,
  mediaKitShellCopy,
  shouldShowMediaKitSummaryTiles,
} from "./media-kit-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("mediaKitRelatedLinks", () => {
  it("builds Media team / Sponsor suite / Outreach / Impact cross-links", () => {
    const links = mediaKitRelatedLinks("org-1", {
      include: [...MEDIA_KIT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["media", "media-library", "sponsor-suite", "outreach-calendar", "impact"]);
    expect(links.find((l) => l.id === "media")?.href).toBe("/media?orgId=org-1");
    expect(links.find((l) => l.id === "media-library")?.href).toBe("/media-library?orgId=org-1");
    expect(links.find((l) => l.id === "sponsor-suite")?.href).toBe(
      "/business?tab=sponsor-suite&orgId=org-1",
    );
    expect(links.find((l) => l.id === "outreach-calendar")?.href).toBe(
      "/business?tab=outreach-calendar&orgId=org-1",
    );
    expect(links.find((l) => l.id === "impact")?.href).toBe("/business?tab=impact&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(mediaKitRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("mediaKitNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = mediaKitNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "sponsor-suite")).toBe(true);
  });

  it("points empty shells at profile + assets", () => {
    const actions = mediaKitNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions[0]?.id).toBe("profile");
    expect(actions[0]?.href).toBe("#media-kit-profile");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyMediaKitShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyMediaKitShell({ loading: true })).toBe("loading");
    expect(classifyMediaKitShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyMediaKitShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyMediaKitShell({
        loading: false,
        orgId: "o1",
        status: "live",
        assetCount: 0,
        documentCount: 0,
        readinessScore: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMediaKitShell({
        loading: false,
        orgId: "o1",
        status: "live",
        assetCount: 1,
        documentCount: 0,
        readinessScore: 0.2,
      }),
    ).toBe("ready");
  });
});

describe("mediaKitShellCopy + format helpers", () => {
  it("refuses invented DEMO media metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = mediaKitShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expect(formatMediaKitMetric(null, false)).toBe("…");
    expect(formatMediaKitMetric(3, true)).toBe("3");
    expect(shouldShowMediaKitSummaryTiles({ assetCount: 0, documentCount: 0, readinessScore: 0 })).toBe(
      false,
    );
    expect(shouldShowMediaKitSummaryTiles({ assetCount: 1, documentCount: 0, readinessScore: 0 })).toBe(
      true,
    );
  });
});
