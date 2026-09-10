import { describe, expect, it } from "vitest";
import {
  classifyMediaShell,
  mediaNextActions,
  mediaRelatedLinks,
  mediaShellCopy,
} from "./media-related";
import { isMediaWorkspaceEmpty, shouldShowMediaSummaryTiles } from ".";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("media-related Soft-UI helpers", () => {
  it("builds Media Kit / Outreach / Impact via hubHref / withOrgHref", () => {
    const links = mediaRelatedLinks("org-1", {
      include: ["media-kit", "outreach-calendar", "impact", "sponsor-wall"],
    });
    expect(links.map((l) => l.id)).toEqual([
      "media-kit",
      "outreach-calendar",
      "impact",
      "sponsor-wall",
    ]);
    expect(links.find((l) => l.id === "media-kit")?.href).toBe("/media-kit?orgId=org-1");
    expect(links.find((l) => l.id === "outreach-calendar")?.href).toBe(
      "/business?tab=outreach-calendar&orgId=org-1",
    );
  });

  it("classifies empty vs ready without inventing DEMO metrics", () => {
    expect(
      classifyMediaShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        assetCount: 0,
        documentCount: 0,
        readinessScore: 0,
        upcomingCount: 0,
        mediaCategoryCount: 0,
        mediaActivityCount: 0,
        publishedEntryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMediaShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        assetCount: 2,
        readinessScore: 0.4,
      }),
    ).toBe("ready");
  });

  it("uses workspace / kit next actions and never invents DEMO metrics", () => {
    const setup = mediaNextActions({ orgId: null, shell: "setup" });
    expect(setup[0]?.href).toBe("/workspace");
    const empty = mediaNextActions({ orgId: "org-1", shell: "empty" });
    expect(empty[0]?.href).toBe("/media-kit?orgId=org-1");
    expect(mediaShellCopy("empty").title).not.toMatch(/\bDEMO\b/);
    expectPlainCopy(mediaShellCopy("empty").description);
  });

  it("hides summary tiles when the board is empty", () => {
    const empty = {
      kit: { assetCount: 0, documentCount: 0, readinessScore: 0 },
      outreach: { upcomingCount: 0, mediaCategoryCount: 0 },
      impact: { mediaActivityCount: 0 },
      sponsorWall: { publishedEntryCount: 0 },
    };
    expect(isMediaWorkspaceEmpty(empty)).toBe(true);
    expect(shouldShowMediaSummaryTiles(empty)).toBe(false);
  });
});
