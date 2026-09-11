import { describe, expect, it } from "vitest";
import {
  INTEL_RELATED_INCLUDE,
  classifyIntelShell,
  formatIntelMetric,
  intelNextActions,
  intelRelatedLinks,
  intelScoutNoteLines,
  intelSetupSteps,
  intelShellCopy,
  intelSourceTypeLabel,
  isIntelLookupEmpty,
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
  it("keeps season-score sync; Strategy / Dossier / Scouting live on the related strip", () => {
    const steps = intelSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["team-data"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
  });

  it("no-org setup is only Choose your team", () => {
    expect(intelSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });
});

describe("Intel metrics", () => {
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
  it("refuses invented DEMO research and engineering jargon in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = intelShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
      expect(copy.description).not.toMatch(/\bTBA\b/i);
      expect(copy.description).not.toMatch(/Statbotics/i);
      expect(copy.description).not.toMatch(/\borg\b/i);
      expect(copy.description).not.toMatch(/metered/i);
      expect(copy.description).not.toMatch(/global team index/i);
    }
    expect(intelShellCopy("empty").badge).toBe("Look up a team");
    expect(intelShellCopy("setup").badge).toBe("Needs setup");
    expect(intelShellCopy("empty").title).toBe("Look up a team");
    expect(intelShellCopy("ready").title).toBe("Research");
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

  it("setup with a team is only Sync season scores", () => {
    const actions = intelNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["team-data"]);
    expect(actions[0]?.primary).toBe(true);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
  });

  it("empty and error shells do not paint a next-actions wall", () => {
    expect(
      intelNextActions({
        orgId: "org-1",
        shell: "empty",
        teamNumber: null,
        findingCount: 0,
      }),
    ).toEqual([]);
    expect(intelNextActions({ orgId: "org-1", shell: "error" })).toEqual([]);
  });

  it("ready boards point at pick desk and chemistry, not the related strip", () => {
    const actions = intelNextActions({
      orgId: "org-1",
      shell: "ready",
      teamNumber: 2337,
      findingCount: 3,
      scoutNoteCount: 2,
    });
    expect(actions.map((a) => a.id)).toEqual(["pick-desk", "chemistry"]);
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(false);
    expect(actions.some((a) => a.id === "dossier")).toBe(false);
    expect(actions.some((a) => a.id === "scouting")).toBe(false);
    for (const action of actions) expectPlainCopy(action.detail);
  });
});

describe("intelScoutNoteLines", () => {
  it("prints only logged fields and never invents a score", () => {
    const lines = intelScoutNoteLines([
      { payload: { cycles: 9, notes: "Strong intake" }, confidence: "high", matchKey: "2026txho_qm1" },
      { payload: {}, confidence: "normal" },
    ]);
    expect(lines[0]?.title).toBe("Match 2026txho_qm1");
    expect(lines[0]?.detail).toContain("cycles 9");
    expect(lines[0]?.detail).toContain("Strong intake");
    expect(lines[1]?.title).toBe("Pit notes");
    expect(lines[1]?.detail).toBe("Logged from our scouting.");
    expect(JSON.stringify(lines)).not.toMatch(/DEMO/i);
  });
});

describe("intelSourceTypeLabel", () => {
  it("uses student-readable source names", () => {
    expect(intelSourceTypeLabel("cd_post")).toBe("Chief Delphi");
    expect(intelSourceTypeLabel("reveal_video")).toBe("Reveal video");
    expect(intelSourceTypeLabel("other")).toBe("Source");
  });
});
