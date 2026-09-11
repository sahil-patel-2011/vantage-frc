import { describe, expect, it } from "vitest";
import {
  GITHUB_RELATED_INCLUDE,
  classifyGitHubShell,
  formatGitHubRepoMetric,
  githubConnectionHref,
  githubNextActions,
  githubRelatedLinks,
  githubSetupSteps,
  githubShellCopy,
  isGitHubBoardEmpty,
  shouldShowGitHubSummaryTiles,
} from "./github-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("githubConnectionHref", () => {
  it("targets Team admin #github-connection via withOrgHref", () => {
    expect(githubConnectionHref("org-1")).toBe("/team/admin?orgId=org-1#github-connection");
    expect(githubConnectionHref(null)).toBe("/team/admin#github-connection");
  });
});

describe("githubRelatedLinks", () => {
  it("builds Pair VS Code / Code Coach / Connectors via hubHref / withOrgHref", () => {
    const links = githubRelatedLinks("org-1", {
      include: [...GITHUB_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["pair", "code", "connections"]);
    expect(links.find((l) => l.id === "pair")?.href).toBe("/editor/pair?orgId=org-1");
    expect(links.find((l) => l.id === "code")?.href).toBe("/build?tab=code&orgId=org-1");
    expect(links.find((l) => l.id === "connections")?.href).toBe("/connectors");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(githubRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("githubSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO repos", () => {
    const steps = githubSetupSteps("org-1");
    expect(steps.find((s) => s.id === "pat")?.href).toBe("/team/admin?orgId=org-1#github-connection");
    expect(steps.find((s) => s.id === "code")?.href).toBe("/build?tab=code&orgId=org-1");
    expect(steps.find((s) => s.id === "pair")?.href).toBe("/editor/pair?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("GitHub Soft-UI metrics", () => {
  it("formats real repo counts only", () => {
    expect(formatGitHubRepoMetric(3, true)).toBe("3");
    expect(formatGitHubRepoMetric(0, false)).toBe("…");
    expect(formatGitHubRepoMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without a real connection or repos", () => {
    expect(shouldShowGitHubSummaryTiles({ connected: false, repoCount: 0 })).toBe(false);
    expect(shouldShowGitHubSummaryTiles({ connected: true, repoCount: 0 })).toBe(false);
    expect(shouldShowGitHubSummaryTiles({ connected: true, repoCount: 2 })).toBe(true);
  });

  it("treats disconnected boards as empty", () => {
    expect(isGitHubBoardEmpty({ connected: false })).toBe(true);
    expect(isGitHubBoardEmpty({ connected: true })).toBe(false);
  });
});

describe("classifyGitHubShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyGitHubShell({ loading: true })).toBe("loading");
    expect(classifyGitHubShell({ fetchFailed: true, hasOrgs: true, orgId: "o" })).toBe("error");
    expect(classifyGitHubShell({ hasOrgs: false })).toBe("setup");
    expect(classifyGitHubShell({ hasOrgs: true, orgId: null })).toBe("setup");
    expect(classifyGitHubShell({ hasOrgs: true, orgId: "o", connected: false })).toBe("empty");
    expect(classifyGitHubShell({ hasOrgs: true, orgId: "o", connected: true })).toBe("ready");
  });
});

describe("githubShellCopy", () => {
  it("refuses invented DEMO repos in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = githubShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expectPlainCopy(githubShellCopy("empty").description);
    expectPlainCopy(githubShellCopy("setup").description);
    expect(githubShellCopy("setup").badge).toBe("Needs setup");
  });
});

describe("githubNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = githubNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.label).toBe("Choose your team");
  });

  it("empty shell has one Connect GitHub / save-token primary", () => {
    const actions = githubNextActions({
      orgId: "org-1",
      shell: "empty",
      connected: false,
      oauthSetupRequired: true,
    });
    expect(actions.map((a) => a.id)).toEqual(["connect"]);
    expect(actions[0]?.label).toBe("Save a GitHub token");
    expect(JSON.stringify(actions)).not.toMatch(/OAuth|\bPAT\b/);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize Code Coach without DEMO repos", () => {
    const actions = githubNextActions({
      orgId: "org-1",
      shell: "ready",
      connected: true,
      hasDefaultRepo: true,
      repoCount: 4,
    });
    expect(actions[0]?.id).toBe("code");
    expect(actions.find((a) => a.id === "pair")?.href).toBe("/editor/pair?orgId=org-1");
    expect(actions.find((a) => a.id === "connections")?.href).toBe("/connectors");
  });
});
