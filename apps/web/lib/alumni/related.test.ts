import { describe, expect, it } from "vitest";
import {
  ALUMNI_RELATED_INCLUDE,
  alumniNextActions,
  alumniRelatedLinks,
  alumniShellCopy,
  classifyAlumniShell,
  formatAlumniMetric,
} from "./related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("alumniRelatedLinks", () => {
  it("builds Alumni network / Team knowledge / Workspace cross-links", () => {
    const links = alumniRelatedLinks("org-1", { include: [...ALUMNI_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["alumni-network", "team-knowledge", "workspace"]);
    expect(links.find((link) => link.id === "alumni-network")?.href).toBe(
      "/alumni-network?orgId=org-1",
    );
    expect(links.find((link) => link.id === "team-knowledge")?.href).toBe(
      "/team/knowledge?orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(alumniRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("classifyAlumniShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO classmates", () => {
    expect(classifyAlumniShell({ loading: true })).toBe("loading");
    expect(classifyAlumniShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyAlumniShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(classifyAlumniShell({ loading: false, orgId: "o1", alumniCount: 0 })).toBe("empty");
    expect(classifyAlumniShell({ loading: false, orgId: "o1", alumniCount: 2 })).toBe("ready");
  });
});

describe("alumniShellCopy + next actions", () => {
  it("refuses invented DEMO classmates in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = alumniShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(alumniShellCopy("empty").description);
    expectPlainCopy(alumniShellCopy("setup").description);
  });

  it("setup without a team tells the reader to Choose your team", () => {
    const actions = alumniNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.label).toBe("Choose your team");
    expect(actions[0]?.detail).toMatch(/Choose your team/);
    expect(actions[0]?.detail).not.toMatch(/\bPick a team\b/);
  });

  it("points empty boards at add + alumni network without DEMO names", () => {
    const actions = alumniNextActions({ orgId: "org-1", shell: "empty", alumniCount: 0 });
    expect(actions.map((action) => action.id)).toEqual(expect.arrayContaining(["add", "alumni-network"]));
    expect(actions.every((action) => !/\bDEMO\b/.test(`${action.label} ${action.detail}`))).toBe(
      true,
    );
  });

  it("formats metrics from real counts only", () => {
    expect(formatAlumniMetric(undefined, false)).toBe("…");
    expect(formatAlumniMetric(3, true)).toBe("3");
    expect(formatAlumniMetric(-1, true)).toBe("0");
  });
});
