import { describe, expect, it } from "vitest";
import {
  BUILD_BURNDOWN_RELATED_INCLUDE,
  buildBurndownNextActions,
  buildBurndownRelatedLinks,
  buildBurndownSetupSteps,
  buildBurndownShellCopy,
  classifyBuildBurndownShell,
  formatBuildBurndownMetric,
  formatBuildBurndownPercent,
  isBuildBurndownBoardEmpty,
  shouldShowBuildBurndownSummaryTiles,
} from "./build-burndown-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("buildBurndownRelatedLinks", () => {
  it("builds Task board / Kickoff / FMEA via hubHref", () => {
    const links = buildBurndownRelatedLinks("org-1", {
      include: [...BUILD_BURNDOWN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["task-board", "kickoff", "fmea"]);
    expect(links.find((l) => l.id === "task-board")?.href).toBe(
      "/team?tab=task-board&orgId=org-1",
    );
    expect(links.find((l) => l.id === "kickoff")?.href).toBe("/build?tab=kickoff&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(buildBurndownRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("buildBurndownSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO metrics", () => {
    const steps = buildBurndownSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "kickoff")?.href).toBe("/build?tab=kickoff&orgId=org-1");
    expect(steps.find((s) => s.id === "task-board")?.href).toBe(
      "/team?tab=task-board&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Build Burndown Soft-UI metrics", () => {
  it("formats real counts and percents only", () => {
    expect(formatBuildBurndownMetric(3, true)).toBe("3");
    expect(formatBuildBurndownMetric(0, false)).toBe("…");
    expect(formatBuildBurndownMetric(-1, true)).toBe("0");
    expect(formatBuildBurndownPercent(0.5, true)).toBe("50%");
    expect(formatBuildBurndownPercent(0, false)).toBe("…");
    expect(formatBuildBurndownPercent(2, true)).toBe("100%");
  });

  it("shows summary tiles when a plan or tasks exist", () => {
    expect(shouldShowBuildBurndownSummaryTiles({ taskCount: 0, hasPlan: false })).toBe(false);
    expect(shouldShowBuildBurndownSummaryTiles({ taskCount: 0, hasPlan: true })).toBe(true);
    expect(shouldShowBuildBurndownSummaryTiles({ taskCount: 1, hasPlan: false })).toBe(true);
  });

  it("treats zero tasks as empty", () => {
    expect(isBuildBurndownBoardEmpty({ taskCount: 0 })).toBe(true);
    expect(isBuildBurndownBoardEmpty({ taskCount: 2 })).toBe(false);
  });
});

describe("classifyBuildBurndownShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO metrics", () => {
    expect(classifyBuildBurndownShell({ loading: true })).toBe("loading");
    expect(classifyBuildBurndownShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyBuildBurndownShell({ status: "setup_required" })).toBe("setup");
    expect(classifyBuildBurndownShell({ orgId: null, status: "live" })).toBe("setup");
    expect(classifyBuildBurndownShell({ orgId: "o", status: "live", taskCount: 0 })).toBe("empty");
    expect(classifyBuildBurndownShell({ orgId: "o", status: "live", taskCount: 1 })).toBe("ready");
  });
});

describe("buildBurndownShellCopy", () => {
  it("refuses invented DEMO metrics in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = buildBurndownShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(buildBurndownShellCopy("empty").description);
    expectPlainCopy(buildBurndownShellCopy("setup").description);
    expect(buildBurndownShellCopy("setup").description).not.toMatch(/pick a team/i);
    expect(buildBurndownShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("buildBurndownNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = buildBurndownNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "task-board")).toBe(true);
  });

  it("empty shell points at plan/task + Kickoff / Task board / FMEA", () => {
    const actions = buildBurndownNextActions({
      orgId: "org-1",
      shell: "empty",
      taskCount: 0,
      hasPlan: false,
    });
    expect(actions[0]?.id).toBe("task");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["kickoff", "task-board", "fmea"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize remaining without DEMO metrics", () => {
    const actions = buildBurndownNextActions({
      orgId: "org-1",
      shell: "ready",
      taskCount: 5,
      remainingTasks: 2,
      hasPlan: true,
    });
    expect(actions[0]?.id).toBe("remaining");
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
