import { describe, expect, it } from "vitest";
import {
  PICKLIST_COLLAB_RELATED_INCLUDE,
  classifyPicklistCollabShell,
  formatPicklistCollabMetric,
  picklistCollabNextActions,
  picklistCollabRelatedLinks,
  picklistCollabShellCopy,
  shouldShowPicklistCollabSummaryTiles,
} from "./picklist-collab-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("picklistCollabRelatedLinks", () => {
  it("builds Strategy / Justifier / Pick clock cross-links", () => {
    const links = picklistCollabRelatedLinks("org-1", {
      include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "picklist-justifier", "pick-clock"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    expect(JSON.stringify(picklistCollabRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("picklistCollabNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = picklistCollabNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty lists at create", () => {
    const actions = picklistCollabNextActions({
      orgId: "org-1",
      shell: "empty",
      listCount: 0,
    });
    expect(actions[0]?.id).toBe("create");
    expect(actions[0]?.href).toBe("#picklist-collab-create");
  });

  it("ready lists prioritize votes without DEMO ranks", () => {
    const actions = picklistCollabNextActions({
      orgId: "org-1",
      shell: "ready",
      listCount: 1,
      totalEntries: 3,
      totalVotes: 2,
    });
    expect(actions[0]?.id).toBe("vote");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyPicklistCollabShell", () => {
  it("classifies shells", () => {
    expect(classifyPicklistCollabShell({ loading: true })).toBe("loading");
    expect(classifyPicklistCollabShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(
      classifyPicklistCollabShell({ status: "live", orgId: "o", listCount: 0 }),
    ).toBe("empty");
    expect(
      classifyPicklistCollabShell({ status: "live", orgId: "o", listCount: 1 }),
    ).toBe("ready");
  });
});

describe("formatPicklistCollabMetric", () => {
  it("formats real counts only", () => {
    expect(formatPicklistCollabMetric(5, true)).toBe("5");
    expect(formatPicklistCollabMetric(null, false)).toBe("…");
    expect(shouldShowPicklistCollabSummaryTiles({ listCount: 1, totalEntries: 0 })).toBe(false);
  });
});

describe("picklistCollabShellCopy", () => {
  it("never invents DEMO ranks", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = picklistCollabShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
