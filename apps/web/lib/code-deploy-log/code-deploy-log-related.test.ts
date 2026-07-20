import { describe, expect, it } from "vitest";
import {
  CODE_DEPLOY_LOG_RELATED_INCLUDE,
  classifyCodeDeployLogShell,
  codeDeployLogNextActions,
  codeDeployLogRelatedLinks,
  codeDeployLogShellCopy,
  formatCodeDeployLogMetric,
  shouldShowCodeDeployLogSummaryTiles,
} from "./code-deploy-log-related";

describe("codeDeployLogRelatedLinks", () => {
  it("builds Code / Perf / CAD cross-links", () => {
    const links = codeDeployLogRelatedLinks("org-1", {
      include: [...CODE_DEPLOY_LOG_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["code", "code-perf", "cad"]);
    expect(links.find((l) => l.id === "code")?.href).toBe("/build?tab=code&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(codeDeployLogRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("codeDeployLogNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = codeDeployLogNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "code")).toBe(true);
  });

  it("points empty boards at log form + Code Coach", () => {
    const actions = codeDeployLogNextActions({
      orgId: "org-1",
      shell: "empty",
      deployCount: 0,
    });
    expect(actions[0]?.href).toBe("#code-deploy-log-form");
    expect(actions.some((a) => a.id === "code")).toBe(true);
  });

  it("ready boards prioritize history without DEMO metrics", () => {
    const actions = codeDeployLogNextActions({
      orgId: "org-1",
      shell: "ready",
      deployCount: 5,
      matchLinkedCount: 2,
    });
    expect(actions[0]?.id).toBe("review-history");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyCodeDeployLogShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyCodeDeployLogShell({ loading: true })).toBe("loading");
    expect(classifyCodeDeployLogShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyCodeDeployLogShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyCodeDeployLogShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        deployCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyCodeDeployLogShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        deployCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatCodeDeployLogMetric(4, true)).toBe("4");
    expect(shouldShowCodeDeployLogSummaryTiles(0)).toBe(false);
  });

  it("copy never invents DEMO firmware trails", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = codeDeployLogShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
