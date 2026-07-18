import { describe, expect, it } from "vitest";
import {
  PAIR_RELATED_INCLUDE,
  classifyPairShell,
  formatPairMetric,
  isPairBoardEmpty,
  pairNextActions,
  pairRelatedLinks,
  pairSetupSteps,
  pairShellCopy,
  shouldShowPairSummaryTiles,
} from "./pair-related";

describe("pairRelatedLinks", () => {
  it("builds Code Coach / GitHub / AI cross-links via hubHref / withOrgHref", () => {
    const links = pairRelatedLinks("org-1", {
      include: [...PAIR_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["code", "github", "chat"]);
    expect(links.find((l) => l.id === "code")?.href).toBe("/build?tab=code&orgId=org-1");
    expect(links.find((l) => l.id === "github")?.href).toBe("/team?orgId=org-1#github-connection");
    expect(links.find((l) => l.id === "chat")?.href).toBe("/ai?tab=chat&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = pairRelatedLinks("org-1", {
      active: "code",
      include: ["github", "chat"],
    });
    expect(links.map((l) => l.id)).toEqual(["github", "chat"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(pairRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("pairSetupSteps", () => {
  it("points setup at Workspace + Code Coach / GitHub / AI", () => {
    const steps = pairSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace", "code", "github", "chat"]);
    expect(steps.find((s) => s.id === "code")?.href).toBe("/build?tab=code&orgId=org-1");
    expect(steps.find((s) => s.id === "github")?.href).toBe("/team?orgId=org-1#github-connection");
    expect(steps.find((s) => s.id === "chat")?.href).toBe("/ai?tab=chat&orgId=org-1");
  });
});

describe("pairNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = pairNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "code")).toBe(true);
    expect(actions.some((a) => a.id === "github")).toBe(true);
    expect(actions.some((a) => a.id === "chat")).toBe(true);
  });

  it("setup with org points at Workspace + Code Coach / GitHub / AI", () => {
    const actions = pairNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "code")).toBe(true);
    expect(actions.some((a) => a.id === "github")).toBe(true);
    expect(actions.some((a) => a.id === "chat")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at approve + Code Coach / GitHub / AI", () => {
    const actions = pairNextActions({
      orgId: "org-1",
      shell: "empty",
      deviceCount: 0,
      hasCode: true,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["approve", "code", "github", "chat"]),
    );
    expect(actions[0]?.href).toBe("#pair-approve");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Code Coach without DEMO counts", () => {
    const actions = pairNextActions({
      orgId: "org-1",
      shell: "ready",
      deviceCount: 2,
    });
    expect(actions[0]?.id).toBe("code");
    expect(actions[0]?.detail).toMatch(/2 paired/);
    expect(actions.some((a) => a.id === "github")).toBe(true);
    expect(actions.some((a) => a.id === "chat")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyPairShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyPairShell({ loading: true })).toBe("loading");
    expect(classifyPairShell({ loading: false, hasOrgs: false, orgId: null })).toBe("setup");
    expect(classifyPairShell({ loading: false, hasOrgs: true, orgId: null })).toBe("setup");
    expect(
      classifyPairShell({ loading: false, hasOrgs: true, orgId: "o1", fetchFailed: true }),
    ).toBe("error");
    expect(
      classifyPairShell({ loading: false, hasOrgs: true, orgId: "o1", deviceCount: 0 }),
    ).toBe("empty");
    expect(
      classifyPairShell({ loading: false, hasOrgs: true, orgId: "o1", deviceCount: 2 }),
    ).toBe("ready");
  });
});

describe("pairShellCopy + metrics", () => {
  it("refuses invented DEMO pairing metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = pairShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(pairShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(pairShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatPairMetric(null, false)).toBe("…");
    expect(formatPairMetric(3, true)).toBe("3");
    expect(formatPairMetric(-1, true)).toBe("0");
    expect(isPairBoardEmpty({ deviceCount: 0 })).toBe(true);
    expect(shouldShowPairSummaryTiles({ deviceCount: 0 })).toBe(false);
    expect(shouldShowPairSummaryTiles({ deviceCount: 1 })).toBe(true);
  });
});
