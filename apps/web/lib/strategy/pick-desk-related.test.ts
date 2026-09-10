import { describe, expect, it } from "vitest";
import {
  PICK_DESK_RELATED_INCLUDE,
  classifyPickDeskShell,
  formatPickDeskMetric,
  isPickDeskPoolEmpty,
  pickDeskNextActions,
  pickDeskRelatedLinks,
  pickDeskSetupSteps,
  pickDeskShellCopy,
  shouldShowPickDeskSummaryTiles,
} from "./pick-desk-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("pickDeskRelatedLinks", () => {
  it("builds Strategy / Scouting / Coverage via hubHref / withOrgHref", () => {
    const links = pickDeskRelatedLinks("org-1", {
      include: [...PICK_DESK_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "scouting", "coverage"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "coverage")?.href).toBe(
      "/scouting/lineup?orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(pickDeskRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("pickDeskSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO picks", () => {
    const steps = pickDeskSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "coverage")?.href).toBe(
      "/scouting/lineup?orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Pick desk Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatPickDeskMetric(3, true)).toBe("3");
    expect(formatPickDeskMetric(0, false)).toBe("…");
    expect(formatPickDeskMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real candidates", () => {
    expect(shouldShowPickDeskSummaryTiles(0)).toBe(false);
    expect(shouldShowPickDeskSummaryTiles(6)).toBe(true);
  });

  it("treats zero candidates as empty pool", () => {
    expect(isPickDeskPoolEmpty({ candidateCount: 0 })).toBe(true);
    expect(isPickDeskPoolEmpty({ candidateCount: 2 })).toBe(false);
  });
});

describe("classifyPickDeskShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO picks", () => {
    expect(classifyPickDeskShell({ loading: true })).toBe("loading");
    expect(classifyPickDeskShell({ fetchFailed: true, orgId: "o", eventKey: "e" })).toBe("error");
    expect(classifyPickDeskShell({ status: "setup_required" })).toBe("setup");
    expect(classifyPickDeskShell({ orgId: null, eventKey: "e", status: "live" })).toBe("setup");
    expect(classifyPickDeskShell({ orgId: "o", eventKey: null, status: "live" })).toBe("setup");
    expect(
      classifyPickDeskShell({ orgId: "o", eventKey: "e", status: "live", candidateCount: 0 }),
    ).toBe("empty");
    expect(
      classifyPickDeskShell({ orgId: "o", eventKey: "e", status: "live", candidateCount: 12 }),
    ).toBe("ready");
  });
});

describe("pickDeskShellCopy", () => {
  it("refuses invented DEMO picks in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = pickDeskShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(pickDeskShellCopy("empty").badge).toBe("No event metrics yet");
    expectPlainCopy(pickDeskShellCopy("empty").description);
    expect(pickDeskShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("pickDeskNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = pickDeskNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
  });

  it("setup with org points at Strategy / Scouting / Coverage", () => {
    const actions = pickDeskNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("command");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Scouting / Coverage", () => {
    const actions = pickDeskNextActions({
      orgId: "org-1",
      shell: "empty",
      candidateCount: 0,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "scouting", "coverage"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes lists without DEMO picks", () => {
    const actions = pickDeskNextActions({
      orgId: "org-1",
      shell: "ready",
      candidateCount: 40,
      listCount: 2,
    });
    expect(actions[0]?.id).toBe("lists");
    expect(actions[0]?.detail).toMatch(/2 saved/);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
