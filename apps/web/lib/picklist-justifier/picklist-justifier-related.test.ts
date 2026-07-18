import { describe, expect, it } from "vitest";
import {
  PICKLIST_JUSTIFIER_RELATED_INCLUDE,
  classifyPicklistJustifierShell,
  formatPicklistJustifierMetric,
  picklistJustifierNextActions,
  picklistJustifierRelatedLinks,
  picklistJustifierShellCopy,
  shouldShowPicklistJustifierSummaryTiles,
} from "./picklist-justifier-related";

describe("picklistJustifierRelatedLinks", () => {
  it("builds Strategy / Collaborative Pick List / Scouting cross-links", () => {
    const links = picklistJustifierRelatedLinks("org-1", {
      include: [...PICKLIST_JUSTIFIER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "picklist-collab", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "picklist-collab")?.href).toBe(
      "/competition?tab=picklist-collab&orgId=org-1",
    );
  });

  it("builds Alliance board via withOrgHref", () => {
    const links = picklistJustifierRelatedLinks("org-1", { include: ["draft"] });
    expect(links[0]?.href).toBe("/strategy/draft?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(picklistJustifierRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("picklistJustifierNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = picklistJustifierNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
  });

  it("points empty boards at Strategy / Collaborative Pick List", () => {
    const actions = picklistJustifierNextActions({
      orgId: "org-1",
      shell: "empty",
      pickListCount: 0,
    });
    expect(actions[0]?.id).toBe("strategy");
    expect(actions.some((a) => a.id === "picklist-collab")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize contradictions without DEMO metrics", () => {
    const actions = picklistJustifierNextActions({
      orgId: "org-1",
      shell: "ready",
      pickListCount: 1,
      slotCount: 4,
      contradictionCount: 2,
    });
    expect(actions[0]?.id).toBe("review-contradictions");
    expect(actions.some((a) => a.id === "draft")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyPicklistJustifierShell + copy", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyPicklistJustifierShell({ loading: true })).toBe("loading");
    expect(classifyPicklistJustifierShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyPicklistJustifierShell({ loading: false, status: "setup_required", orgId: null }),
    ).toBe("setup");
    expect(
      classifyPicklistJustifierShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        pickListCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyPicklistJustifierShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        pickListCount: 1,
      }),
    ).toBe("ready");
  });

  it("copy never invents DEMO rationales", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = picklistJustifierShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(/never DEMO|nothing is pre-seeded|pick/i);
    }
  });
});

describe("formatPicklistJustifierMetric", () => {
  it("formats real counts only", () => {
    expect(formatPicklistJustifierMetric(null, false)).toBe("…");
    expect(formatPicklistJustifierMetric(5, true)).toBe("5");
    expect(shouldShowPicklistJustifierSummaryTiles(0)).toBe(false);
    expect(shouldShowPicklistJustifierSummaryTiles(1)).toBe(true);
  });
});
