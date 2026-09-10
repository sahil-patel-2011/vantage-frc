import { describe, expect, it } from "vitest";
import {
  INTEL_RELATED_INCLUDE,
  classifyIntelShell,
  formatIntelMetric,
  isIntelLookupEmpty,
  intelNextActions,
  intelRelatedLinks,
  intelSetupSteps,
  intelShellCopy,
} from "./intel-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("intelRelatedLinks", () => {
  it("builds Strategy / Dossier / Scouting via hubHref / withOrgHref", () => {
    const links = intelRelatedLinks("org-1", {
      include: [...INTEL_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "dossier", "scouting"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "dossier")?.href).toBe("/dossier?orgId=org-1");
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("pins Dossier to a selected team number", () => {
    const links = intelRelatedLinks("org-1", {
      include: ["dossier"],
      teamNumber: 2337,
    });
    expect(links[0]?.href).toBe("/dossier?team=2337&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(intelRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("intelSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO research", () => {
    const steps = intelSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "dossier")?.href).toBe("/dossier?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Intel Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatIntelMetric(8, true)).toBe("8");
    expect(formatIntelMetric(0, false)).toBe("…");
    expect(formatIntelMetric(-1, true)).toBe("0");
  });

  it("treats no selected team as empty", () => {
    expect(isIntelLookupEmpty(false)).toBe(true);
    expect(isIntelLookupEmpty(true)).toBe(false);
  });
});

describe("classifyIntelShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO research", () => {
    expect(classifyIntelShell({ loading: true })).toBe("loading");
    expect(classifyIntelShell({ fetchFailed: true, orgId: "o", hasSelectedTeam: true })).toBe(
      "error",
    );
    expect(classifyIntelShell({ orgId: null })).toBe("setup");
    expect(classifyIntelShell({ orgId: "o", hasSelectedTeam: false })).toBe("empty");
    expect(classifyIntelShell({ orgId: "o", hasSelectedTeam: true })).toBe("ready");
  });
});

describe("intelShellCopy", () => {
  it("refuses invented DEMO research in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = intelShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(intelShellCopy("empty").badge).toBe("Look up a team");
    expectPlainCopy(intelShellCopy("empty").description);
    expect(intelShellCopy("setup").badge).toBe("Setup required");
    expectPlainCopy(intelShellCopy("ready").description);
  });
});

describe("intelNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = intelNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "dossier")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Strategy / Dossier / Scouting", () => {
    const actions = intelNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "dossier")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Dossier / Scouting", () => {
    const actions = intelNextActions({
      orgId: "org-1",
      shell: "empty",
      teamNumber: null,
      findingCount: 0,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "dossier", "scouting"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes research findings without DEMO research", () => {
    const actions = intelNextActions({
      orgId: "org-1",
      shell: "ready",
      teamNumber: 2337,
      findingCount: 3,
    });
    expect(actions[0]?.id).toBe("intel");
    expect(actions[0]?.detail).toMatch(/3 source-linked finding/);
    expect(actions[0]?.href).toBe("/intel?team=2337&orgId=org-1");
    expect(actions.find((a) => a.id === "dossier")?.href).toBe(
      "/dossier?team=2337&orgId=org-1",
    );
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
