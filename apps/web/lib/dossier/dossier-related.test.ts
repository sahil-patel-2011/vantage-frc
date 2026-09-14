import { describe, expect, it } from "vitest";
import {
  DOSSIER_RELATED_INCLUDE,
  classifyDossierShell,
  formatDossierMetric,
  isDossierFactsEmpty,
  dossierNextActions,
  dossierRelatedLinks,
  dossierSetupSteps,
  dossierShellCopy,
  shouldShowDossierSummaryTiles,
} from "./dossier-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("dossierRelatedLinks", () => {
  it("builds Strategy / Scouting / Pick desk via hubHref / withOrgHref", () => {
    const links = dossierRelatedLinks("org-1", {
      include: [...DOSSIER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "scouting", "pick-desk"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "pick-desk")?.href).toBe(
      "/strategy?tab=picks&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(dossierRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("dossierSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(dossierSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Sync Team Data; Strategy / Scouting / Pick desk live on the related strip", () => {
    const steps = dossierSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["team-data"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Dossier Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatDossierMetric(8, true)).toBe("8");
    expect(formatDossierMetric(0, false)).toBe("…");
    expect(formatDossierMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real fact cards", () => {
    expect(shouldShowDossierSummaryTiles(0)).toBe(false);
    expect(shouldShowDossierSummaryTiles(3)).toBe(true);
  });

  it("treats zero cards as empty", () => {
    expect(isDossierFactsEmpty(0)).toBe(true);
    expect(isDossierFactsEmpty(2)).toBe(false);
  });
});

describe("classifyDossierShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO stats", () => {
    expect(classifyDossierShell({ loading: true })).toBe("loading");
    expect(classifyDossierShell({ fetchFailed: true, orgId: "o", teamNumber: 1 })).toBe(
      "error",
    );
    expect(classifyDossierShell({ status: "setup_required" })).toBe("setup");
    expect(classifyDossierShell({ orgId: null, teamNumber: 1, status: "live" })).toBe("setup");
    expect(
      classifyDossierShell({
        orgId: "o",
        teamNumber: 2337,
        status: "empty",
        cardCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDossierShell({
        orgId: "o",
        teamNumber: null,
        status: "live",
        cardCount: 5,
      }),
    ).toBe("empty");
    expect(
      classifyDossierShell({
        orgId: "o",
        teamNumber: 2337,
        status: "live",
        cardCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDossierShell({
        orgId: "o",
        teamNumber: 2337,
        status: "live",
        cardCount: 5,
      }),
    ).toBe("ready");
  });
});

describe("dossierShellCopy", () => {
  it("refuses invented DEMO stats in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = dossierShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(dossierShellCopy("empty").badge).toBe("No facts yet");
    expectPlainCopy(dossierShellCopy("empty").description);
    expect(dossierShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(dossierShellCopy("ready").description);
  });
});

describe("dossierNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = dossierNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org is only Sync Team Data", () => {
    const actions = dossierNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["team-data"]);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Team Data / Strategy / Scouting / Pick desk", () => {
    const actions = dossierNextActions({
      orgId: "org-1",
      shell: "empty",
      teamNumber: 2337,
      cardCount: 0,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["team-data", "strategy", "scouting", "pick-desk"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("ready prioritizes dossier without DEMO stats", () => {
    const actions = dossierNextActions({
      orgId: "org-1",
      shell: "ready",
      teamNumber: 2337,
      cardCount: 8,
    });
    expect(actions[0]?.id).toBe("dossier");
    expect(actions[0]?.detail).toMatch(/8 cited fact/);
    expect(actions[0]?.href).toBe("/dossier?team=2337&orgId=org-1");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "pick-desk")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
