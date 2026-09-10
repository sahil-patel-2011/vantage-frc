import { describe, expect, it } from "vitest";
import {
  PICKLIST_COLLAB_RELATED_INCLUDE,
  classifyPicklistCollabShell,
  formatPicklistCollabMetric,
  picklistCollabNextActions,
  picklistCollabRelatedLinks,
  picklistCollabSetupSteps,
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

describe("picklistCollabSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(picklistCollabSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Set active event; Strategy / Justifier / Pick clock live on the related strip", () => {
    const steps = picklistCollabSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
  });
});

describe("picklistCollabNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = picklistCollabNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org is only Set active event", () => {
    const actions = picklistCollabNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["command"]);
    expect(actions[0]?.href).toBe("/competition?tab=command&orgId=org-1");
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
