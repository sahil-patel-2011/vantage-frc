import { describe, expect, it } from "vitest";
import {
  CHEMISTRY_RELATED_INCLUDE,
  classifyChemistryShell,
  formatChemistryMetric,
  isChemistryScoreEmpty,
  chemistryNextActions,
  chemistryRelatedLinks,
  chemistrySetupSteps,
  chemistryShellCopy,
  shouldShowChemistrySummaryTiles,
} from "./chemistry-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("chemistryRelatedLinks", () => {
  it("builds Strategy / Pick desk / Draft via hubHref / withOrgHref", () => {
    const links = chemistryRelatedLinks("org-1", {
      include: [...CHEMISTRY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "pick-desk", "draft"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(links.find((l) => l.id === "draft")?.href).toBe("/strategy/draft?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(chemistryRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("chemistrySetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO chemistry scores", () => {
    const steps = chemistrySetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "draft")?.href).toBe("/strategy/draft?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Chemistry Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatChemistryMetric(3, true)).toBe("3");
    expect(formatChemistryMetric(0, false)).toBe("…");
    expect(formatChemistryMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without a real score", () => {
    expect(shouldShowChemistrySummaryTiles(0, false)).toBe(false);
    expect(shouldShowChemistrySummaryTiles(3, false)).toBe(false);
    expect(shouldShowChemistrySummaryTiles(3, true)).toBe(true);
  });

  it("treats fewer than 2 seats or missing score as empty", () => {
    expect(isChemistryScoreEmpty({ seatCount: 1, hasScore: true })).toBe(true);
    expect(isChemistryScoreEmpty({ seatCount: 3, hasScore: false })).toBe(true);
    expect(isChemistryScoreEmpty({ seatCount: 2, hasScore: true })).toBe(false);
  });
});

describe("classifyChemistryShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO chemistry scores", () => {
    expect(classifyChemistryShell({ loading: true })).toBe("loading");
    expect(classifyChemistryShell({ fetchFailed: true, orgId: "o", eventKey: "e" })).toBe(
      "error",
    );
    expect(classifyChemistryShell({ status: "setup_required" })).toBe("setup");
    expect(classifyChemistryShell({ orgId: null, eventKey: "e", status: "live" })).toBe("setup");
    expect(classifyChemistryShell({ orgId: "o", eventKey: null, status: "live" })).toBe("setup");
    expect(
      classifyChemistryShell({
        orgId: "o",
        eventKey: "e",
        status: "empty",
        seatCount: 0,
        hasScore: false,
      }),
    ).toBe("empty");
    expect(
      classifyChemistryShell({
        orgId: "o",
        eventKey: "e",
        status: "live",
        seatCount: 3,
        hasScore: false,
      }),
    ).toBe("empty");
    expect(
      classifyChemistryShell({
        orgId: "o",
        eventKey: "e",
        status: "live",
        seatCount: 3,
        hasScore: true,
      }),
    ).toBe("ready");
  });
});

describe("chemistryShellCopy", () => {
  it("refuses invented DEMO chemistry scores in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = chemistryShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(chemistryShellCopy("empty").badge).toBe("No chemistry score yet");
    expectPlainCopy(chemistryShellCopy("empty").description);
    expect(chemistryShellCopy("setup").badge).toBe("Setup required");
    expectPlainCopy(chemistryShellCopy("ready").description);
  });
});

describe("chemistryNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = chemistryNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "draft")).toBe(true);
  });

  it("setup with org points at Strategy / Pick desk / Draft", () => {
    const actions = chemistryNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("command");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "draft")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Pick desk / Draft", () => {
    const actions = chemistryNextActions({
      orgId: "org-1",
      shell: "empty",
      seatCount: 0,
      hasScore: false,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "pick-desk", "draft"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes chemistry without DEMO scores", () => {
    const actions = chemistryNextActions({
      orgId: "org-1",
      shell: "ready",
      seatCount: 3,
      hasScore: true,
    });
    expect(actions[0]?.id).toBe("chemistry");
    expect(actions[0]?.detail).toMatch(/3 seat/);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.some((a) => a.id === "draft")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
