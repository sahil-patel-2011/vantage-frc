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
  it("keeps Sync Team Data; Strategy / Dossier / Scouting live on the related strip", () => {
    const steps = intelSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["team-data"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
  });

  it("no-org setup is only Choose your team", () => {
    expect(intelSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
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
    expect(intelShellCopy("setup").badge).toBe("Setup");
    expectPlainCopy(intelShellCopy("setup").description);
    expectPlainCopy(intelShellCopy("ready").description);
  });
});

describe("intelNextActions", () => {
  it("gates on workspace when no org and does not repeat the related strip", () => {
    const actions = intelNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(false);
  });

  it("setup with a team is only Sync Team Data", () => {
    const actions = intelNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["team-data"]);
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
  });

  it("empty shell points at Team Data only", () => {
    const actions = intelNextActions({
      orgId: "org-1",
      shell: "empty",
      teamNumber: null,
      findingCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["team-data"]);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
  });

  it("does not add a second guided list on a looked-up team", () => {
    expect(
      intelNextActions({
        orgId: "org-1",
        shell: "ready",
        teamNumber: 2337,
        findingCount: 3,
      }),
    ).toEqual([]);
  });
});
