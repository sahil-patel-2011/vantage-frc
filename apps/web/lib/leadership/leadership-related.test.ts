import { describe, expect, it } from "vitest";
import {
  LEADERSHIP_RELATED_INCLUDE,
  classifyLeadershipShell,
  leadershipNextActions,
  leadershipRelatedLinks,
  leadershipSetupSteps,
  leadershipShellCopy,
  shouldShowLeadershipSummaryTiles,
} from "./leadership-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("leadershipRelatedLinks", () => {
  it("builds Season roles / Skills / Safety cross-links", () => {
    const links = leadershipRelatedLinks("org-1", {
      include: [...LEADERSHIP_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["roles", "skills-graph", "safety-training"]);
    expect(links.find((l) => l.id === "roles")?.href).toBe("/team?tab=roles&orgId=org-1");
    expect(links.find((l) => l.id === "roles")?.label).toBe("Season roles");
    expect(links.find((l) => l.id === "safety-training")?.label).toBe("Safety");
  });
});

describe("leadershipNextActions", () => {
  it("gates on Choose your team when org is missing", () => {
    const actions = leadershipNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.label).toBe("Choose your team");
    expect(actions).toHaveLength(1);
  });

  it("setup actions match setup steps", () => {
    const steps = leadershipSetupSteps("org-1");
    const actions = leadershipNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(steps.map((s) => s.id));
    expect(actions.map((a) => a.href)).toEqual(steps.map((s) => s.href));
  });

  it("empty boards keep next-actions off so the add-role form is the one primary", () => {
    const actions = leadershipNextActions({ orgId: "org-1", shell: "empty", roleCount: 0 });
    expect(actions).toEqual([]);
  });

  it("ready boards review who is next and do not repeat Season roles or Skills", () => {
    const actions = leadershipNextActions({ orgId: "org-1", shell: "ready", roleCount: 2 });
    expect(actions.map((a) => a.id)).toEqual(["handoff-board"]);
    expect(JSON.stringify(actions)).not.toMatch(/Open Season roles|Open Skills|skills-graph/);
  });
});

describe("classifyLeadershipShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyLeadershipShell({ loading: true })).toBe("loading");
    expect(classifyLeadershipShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyLeadershipShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyLeadershipShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        roleCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyLeadershipShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        roleCount: 3,
      }),
    ).toBe("ready");
  });

  it("hides zeroed succession tiles until a role exists", () => {
    expect(shouldShowLeadershipSummaryTiles(0)).toBe(false);
    expect(shouldShowLeadershipSummaryTiles(1)).toBe(true);
  });

  it("copy stays student-readable", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = leadershipShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      if (kind === "setup") expect(copy.badge).toBe("Needs setup");
    }
  });
});
