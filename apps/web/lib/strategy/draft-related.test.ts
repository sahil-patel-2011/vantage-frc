import { describe, expect, it } from "vitest";
import {
  DRAFT_RELATED_INCLUDE,
  classifyDraftShell,
  formatDraftMetric,
  isDraftBoardEmpty,
  isDraftShareTokenOrgIsolated,
  draftNextActions,
  draftRelatedLinks,
  draftSetupSteps,
  draftShellCopy,
  shouldShowDraftSummaryTiles,
} from "./draft-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("draftRelatedLinks", () => {
  it("builds Strategy / Pick desk / Scouting via hubHref / withOrgHref", () => {
    const links = draftRelatedLinks("org-1", {
      include: [...DRAFT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "pick-desk", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(draftRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("draftSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(draftSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Set active event; Strategy / Pick desk / Scouting live on the related strip", () => {
    const steps = draftSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Draft Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatDraftMetric(3, true)).toBe("3");
    expect(formatDraftMetric(0, false)).toBe("…");
    expect(formatDraftMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real teams", () => {
    expect(shouldShowDraftSummaryTiles(0)).toBe(false);
    expect(shouldShowDraftSummaryTiles(6)).toBe(true);
  });

  it("treats missing board or zero teams as empty", () => {
    expect(isDraftBoardEmpty({ hasBoard: false, teamCount: 12 })).toBe(true);
    expect(isDraftBoardEmpty({ hasBoard: true, teamCount: 0 })).toBe(true);
    expect(isDraftBoardEmpty({ hasBoard: true, teamCount: 2 })).toBe(false);
  });
});

describe("isDraftShareTokenOrgIsolated", () => {
  it("requires both orgId and boardId — never cross-org DEMO boards", () => {
    expect(isDraftShareTokenOrgIsolated({ orgId: "org-1", boardId: "board-1" })).toBe(true);
    expect(isDraftShareTokenOrgIsolated({ orgId: "org-1", boardId: null })).toBe(false);
    expect(isDraftShareTokenOrgIsolated({ orgId: null, boardId: "board-1" })).toBe(false);
    expect(isDraftShareTokenOrgIsolated({})).toBe(false);
  });
});

describe("classifyDraftShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO boards", () => {
    expect(classifyDraftShell({ loading: true })).toBe("loading");
    expect(classifyDraftShell({ fetchFailed: true, orgId: "o", eventKey: "e" })).toBe("error");
    expect(classifyDraftShell({ status: "setup_required" })).toBe("setup");
    expect(classifyDraftShell({ orgId: null, eventKey: "e", status: "live" })).toBe("setup");
    expect(classifyDraftShell({ orgId: "o", eventKey: null, status: "live" })).toBe("setup");
    expect(
      classifyDraftShell({
        orgId: "o",
        eventKey: "e",
        status: "live",
        hasBoard: false,
        teamCount: 12,
      }),
    ).toBe("empty");
    expect(
      classifyDraftShell({
        orgId: "o",
        eventKey: "e",
        status: "live",
        hasBoard: true,
        teamCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDraftShell({
        orgId: "o",
        eventKey: "e",
        status: "live",
        hasBoard: true,
        teamCount: 12,
      }),
    ).toBe("ready");
  });
});

describe("draftShellCopy", () => {
  it("refuses invented DEMO boards in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = draftShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(draftShellCopy("empty").badge).toBe("No draft board yet");
    expectPlainCopy(draftShellCopy("empty").description);
    expect(draftShellCopy("setup").badge).toBe("Setup required");
    expect(draftShellCopy("ready").description).toMatch(/org-bound/i);
  });
});

describe("draftNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = draftNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org is only Set active event", () => {
    const actions = draftNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["command"]);
    expect(actions[0]?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Pick desk / Scouting", () => {
    const actions = draftNextActions({
      orgId: "org-1",
      shell: "empty",
      hasBoard: false,
      teamCount: 0,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "pick-desk", "scouting"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes board without DEMO boards and keeps org-bound share copy", () => {
    const actions = draftNextActions({
      orgId: "org-1",
      shell: "ready",
      hasBoard: true,
      teamCount: 40,
      filledSlots: 3,
    });
    expect(actions[0]?.id).toBe("board");
    expect(actions[0]?.detail).toMatch(/3 filled/);
    expect(actions[0]?.detail).toMatch(/org-bound/i);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
