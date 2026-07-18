import { describe, expect, it } from "vitest";
import {
  TEAM_DATA_RELATED_INCLUDE,
  classifyTeamDataShell,
  isTbaConfigured,
  referenceCount,
  teamDataNextActions,
  teamDataRelatedLinks,
} from "./team-data-related";

describe("teamDataRelatedLinks", () => {
  it("builds Schedule / Event Day / Strategy cross-links", () => {
    const links = teamDataRelatedLinks("org-1", { include: [...TEAM_DATA_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["schedule", "command", "strategy"]);
    expect(links.find((l) => l.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe("/strategy?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = teamDataRelatedLinks("org-1", {
      active: "schedule",
      include: ["command", "strategy"],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "strategy"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(teamDataRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("teamDataNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = teamDataNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup without active event sends users to Workspace + Event Day + Schedule", () => {
    const actions = teamDataNextActions({
      orgId: "org-1",
      shell: "setup",
      hasActiveEvent: false,
    });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.some((a) => a.id === "schedule")).toBe(true);
  });

  it("setup without TBA points at saving a key — never DEMO metrics", () => {
    const actions = teamDataNextActions({
      orgId: "org-1",
      shell: "setup",
      hasActiveEvent: true,
      tbaConfigured: false,
    });
    expect(actions[0]?.id).toBe("team-data");
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty caches at sync + Schedule / Event Day / Strategy", () => {
    const actions = teamDataNextActions({
      orgId: "org-1",
      shell: "empty",
      hasActiveEvent: true,
      tbaConfigured: true,
      matchCount: 0,
      metricCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["sync", "schedule", "command", "strategy"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Schedule", () => {
    const actions = teamDataNextActions({
      orgId: "org-1",
      shell: "ready",
      matchCount: 40,
      metricCount: 12,
    });
    expect(actions[0]?.id).toBe("schedule");
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
  });
});

describe("classifyTeamDataShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO metrics", () => {
    expect(classifyTeamDataShell({ loading: true })).toBe("loading");
    expect(classifyTeamDataShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyTeamDataShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyTeamDataShell({
        loading: false,
        orgId: "o1",
        hasActiveEvent: false,
        tbaConfigured: true,
      }),
    ).toBe("setup");
    expect(
      classifyTeamDataShell({
        loading: false,
        orgId: "o1",
        hasActiveEvent: true,
        tbaConfigured: false,
      }),
    ).toBe("setup");
    expect(
      classifyTeamDataShell({
        loading: false,
        orgId: "o1",
        hasActiveEvent: true,
        tbaConfigured: true,
        matchCount: 0,
        metricCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyTeamDataShell({
        loading: false,
        orgId: "o1",
        hasActiveEvent: true,
        tbaConfigured: true,
        matchCount: 4,
        metricCount: 0,
      }),
    ).toBe("ready");
  });
});

describe("referenceCount / isTbaConfigured", () => {
  it("reads real counts and never invents DEMO values", () => {
    expect(referenceCount([{ label: "matches_ref", count: 12 }], "matches_ref")).toBe(12);
    expect(referenceCount([{ label: "matches_ref", count: 0 }], "matches_ref")).toBe(0);
    expect(referenceCount([], "matches_ref")).toBe(0);
  });

  it("treats credentials or last-good cache as configured", () => {
    expect(isTbaConfigured({ credentialCount: 1 })).toBe(true);
    expect(isTbaConfigured({ cacheHasRows: true })).toBe(true);
    expect(isTbaConfigured({ healthStatus: "ok" })).toBe(true);
    expect(isTbaConfigured({ healthStatus: "unknown" })).toBe(false);
    expect(isTbaConfigured({ dataSourceMode: "unavailable" })).toBe(false);
    expect(isTbaConfigured({})).toBe(false);
  });
});
