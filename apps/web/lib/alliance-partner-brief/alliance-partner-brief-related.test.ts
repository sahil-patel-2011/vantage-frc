import { describe, expect, it } from "vitest";
import {
  ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE,
  alliancePartnerBriefNextActions,
  alliancePartnerBriefRelatedLinks,
  alliancePartnerBriefShellCopy,
  classifyAlliancePartnerBriefShell,
  formatAlliancePartnerBriefMetric,
  shouldShowAlliancePartnerBriefSummaryTiles,
} from "./alliance-partner-brief-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("alliancePartnerBriefRelatedLinks", () => {
  it("builds Strategy / Alliance board / Scouting cross-links", () => {
    const links = alliancePartnerBriefRelatedLinks("org-1", {
      include: [...ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "alliance-board", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "alliance-board")?.href).toBe(
      "/strategy/draft?orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = alliancePartnerBriefRelatedLinks("org-1", {
      active: "strategy",
      include: ["alliance-board", "chemistry"],
    });
    expect(links.map((l) => l.id)).toEqual(["alliance-board", "chemistry"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(alliancePartnerBriefRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("alliancePartnerBriefNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = alliancePartnerBriefNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "alliance-board")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Workspace + Alliance board / Strategy / Scouting", () => {
    const actions = alliancePartnerBriefNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "alliance-board")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at alliance-board + Strategy / Scouting", () => {
    const actions = alliancePartnerBriefNextActions({
      orgId: "org-1",
      shell: "empty",
      finalizedCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["alliance-board", "strategy", "scouting"]),
    );
    expect(actions[0]?.href).toBe("/strategy/draft?orgId=org-1");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize generate/review without DEMO metrics", () => {
    const generate = alliancePartnerBriefNextActions({
      orgId: "org-1",
      shell: "ready",
      finalizedCount: 2,
      hasBrief: false,
    });
    expect(generate[0]?.id).toBe("generate-brief");
    expect(generate.some((a) => a.id === "strategy")).toBe(true);
    expect(generate.some((a) => a.id === "alliance-board")).toBe(true);
    expect(generate.some((a) => a.id === "scouting")).toBe(true);

    const review = alliancePartnerBriefNextActions({
      orgId: "org-1",
      shell: "ready",
      finalizedCount: 2,
      hasBrief: true,
      partnerCount: 2,
    });
    expect(review[0]?.id).toBe("review-partners");
    expect(review.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyAlliancePartnerBriefShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyAlliancePartnerBriefShell({ loading: true })).toBe("loading");
    expect(classifyAlliancePartnerBriefShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyAlliancePartnerBriefShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyAlliancePartnerBriefShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyAlliancePartnerBriefShell({
        loading: false,
        orgId: "o1",
        status: "live",
        finalizedCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyAlliancePartnerBriefShell({
        loading: false,
        orgId: "o1",
        status: "live",
        finalizedCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("alliancePartnerBriefShellCopy + format helpers", () => {
  it("refuses invented DEMO partner metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = alliancePartnerBriefShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(alliancePartnerBriefShellCopy("empty").description);
    expectPlainCopy(alliancePartnerBriefShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatAlliancePartnerBriefMetric(null, false)).toBe("…");
    expect(formatAlliancePartnerBriefMetric(3, true)).toBe("3");
    expect(formatAlliancePartnerBriefMetric(-1, true)).toBe("0");
    expect(shouldShowAlliancePartnerBriefSummaryTiles(0)).toBe(false);
    expect(shouldShowAlliancePartnerBriefSummaryTiles(2)).toBe(true);
  });
});
