import { describe, expect, it } from "vitest";
import {
  TUNING_AUTOPILOT_RELATED_INCLUDE,
  classifyTuningAutopilotShell,
  formatTuningAutopilotMetric,
  formatTuningScorePct,
  tuningAutopilotNextActions,
  tuningAutopilotRelatedLinks,
  tuningAutopilotShellCopy,
} from "./tuning-autopilot-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("tuningAutopilotRelatedLinks", () => {
  it("builds CAD / FMEA / Practice cross-links", () => {
    const links = tuningAutopilotRelatedLinks("org-1", {
      include: [...TUNING_AUTOPILOT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["cad", "fmea", "practice"]);
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "practice")?.href).toBe("/team?tab=practice&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = tuningAutopilotRelatedLinks("org-1", {
      active: "fmea",
      include: ["cad", "practice"],
    });
    expect(links.map((l) => l.id)).toEqual(["cad", "practice"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(tuningAutopilotRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("tuningAutopilotNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = tuningAutopilotNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
  });

  it("setup with org points at Workspace + CAD / FMEA / Practice", () => {
    const actions = tuningAutopilotNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at start-session + CAD / FMEA / Practice", () => {
    const actions = tuningAutopilotNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["start-session", "cad", "fmea", "practice"]),
    );
    expect(actions[0]?.href).toBe("#tuning-autopilot-new-session");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize logging / suggestions without DEMO metrics", () => {
    const actions = tuningAutopilotNextActions({
      orgId: "org-1",
      shell: "ready",
      sessionCount: 1,
      iterationCount: 2,
      hasSuggestion: true,
      converged: false,
    });
    expect(actions[0]?.id).toBe("try-suggestion");
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyTuningAutopilotShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyTuningAutopilotShell({ loading: true })).toBe("loading");
    expect(classifyTuningAutopilotShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyTuningAutopilotShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyTuningAutopilotShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyTuningAutopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sessionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyTuningAutopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sessionCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("tuningAutopilotShellCopy + format helpers", () => {
  it("refuses invented DEMO gain metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = tuningAutopilotShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(tuningAutopilotShellCopy("empty").description);
    expectPlainCopy(tuningAutopilotShellCopy("setup").description);
  });

  it("formats real counts and blanks scores until iterations exist", () => {
    expect(formatTuningAutopilotMetric(null, false)).toBe("…");
    expect(formatTuningAutopilotMetric(3, true)).toBe("3");
    expect(formatTuningAutopilotMetric(-1, true)).toBe("0");
    expect(formatTuningScorePct(0.42, true, false)).toBe("—");
    expect(formatTuningScorePct(0.42, true, true)).toBe("42%");
  });
});
