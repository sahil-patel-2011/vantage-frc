import { describe, expect, it } from "vitest";
import {
  SCOUTING_RELATED_INCLUDE,
  classifyScoutingShell,
  formatScoutingMetric,
  scoutingNextActions,
  scoutingOfflineBannerDetail,
  scoutingRelatedLinks,
  scoutingSetupSteps,
  scoutingShellCopy,
  shouldShowScoutingRecentEntries,
} from "./scouting-related";

describe("scoutingRelatedLinks", () => {
  it("builds Forms / Coverage / Strategy / Offline via hubHref / withOrgHref", () => {
    const links = scoutingRelatedLinks("org-1", {
      include: [...SCOUTING_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["forms", "coverage", "strategy", "offline"]);
    expect(links.find((l) => l.id === "forms")?.href).toBe(
      "/competition?tab=forms&orgId=org-1",
    );
    expect(links.find((l) => l.id === "coverage")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "offline")?.href).toBe("/offline?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutingRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutingSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO entries", () => {
    const steps = scoutingSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "forms")?.href).toBe(
      "/competition?tab=forms&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "coverage")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(steps.find((s) => s.id === "offline")?.href).toBe("/offline?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scouting Soft-UI metrics", () => {
  it("formats real counts only and hides empty recent lists", () => {
    expect(formatScoutingMetric(3, true)).toBe("3");
    expect(formatScoutingMetric(0, false)).toBe("…");
    expect(formatScoutingMetric(-1, true)).toBe("0");
    expect(shouldShowScoutingRecentEntries(2)).toBe(true);
    expect(shouldShowScoutingRecentEntries(0)).toBe(false);
  });
});

describe("scoutingOfflineBannerDetail", () => {
  it("uses real queue counts and never DEMO sync copy", () => {
    expect(
      scoutingOfflineBannerDetail({
        online: false,
        syncState: "idle",
        pendingEntries: 1,
        pendingMedia: 0,
      }),
    ).toMatch(/1 item/);
    expect(
      scoutingOfflineBannerDetail({
        online: true,
        syncState: "syncing",
        pendingEntries: 2,
        pendingMedia: 1,
      }),
    ).toMatch(/3 queued/);
    expect(
      scoutingOfflineBannerDetail({
        online: true,
        syncState: "idle",
        pendingEntries: 0,
        pendingMedia: 0,
      }),
    ).toBeUndefined();
    const blob = JSON.stringify(
      scoutingOfflineBannerDetail({
        online: true,
        syncState: "degraded",
        pendingEntries: 4,
        pendingMedia: 1,
      }),
    );
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("classifyScoutingShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO entries", () => {
    expect(classifyScoutingShell({ loading: true })).toBe("loading");
    expect(classifyScoutingShell({ fetchFailed: true, orgId: "org-1" })).toBe("error");
    expect(classifyScoutingShell({ orgId: null })).toBe("setup");
    expect(classifyScoutingShell({ orgId: "org-1", eventKey: null })).toBe("setup");
    expect(
      classifyScoutingShell({ orgId: "org-1", eventKey: "2026casj", hasSchema: false }),
    ).toBe("empty");
    expect(
      classifyScoutingShell({ orgId: "org-1", eventKey: "2026casj", hasSchema: true }),
    ).toBe("ready");
  });
});

describe("scoutingShellCopy", () => {
  it("refuses invented DEMO entries in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutingShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(scoutingShellCopy("empty").badge).toBe("Forms required");
    expect(scoutingShellCopy("empty").description).not.toMatch(/DEMO/i);
    expect(scoutingShellCopy("setup").badge).toBe("Setup required");
    expect(scoutingShellCopy("ready").description).not.toMatch(/DEMO/i);
  });
});

describe("scoutingNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = scoutingNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["forms", "coverage", "strategy", "offline"]),
    );
  });

  it("points empty boards at Forms / Coverage / Strategy / Offline — never DEMO entries", () => {
    const actions = scoutingNextActions({
      orgId: "org-1",
      shell: "empty",
      eventKey: "2026casj",
      canManageSchemas: true,
      entryType: "match",
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["forms", "coverage", "strategy", "offline"]),
    );
    expect(actions[0]?.id).toBe("forms");
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
    expect(actions.every((a) => !/DEMO/i.test(a.detail))).toBe(true);
    expect(actions.find((a) => a.id === "forms")?.href).toBe(
      "/competition?tab=forms&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "coverage")?.href).toBe(
      "/scouting/lineup?orgId=org-1",
    );
    expect(actions.find((a) => a.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "offline")?.href).toBe("/offline?orgId=org-1");
  });

  it("ready boards prioritize Form builder", () => {
    const actions = scoutingNextActions({ orgId: "org-1", shell: "ready" });
    expect(actions[0]?.id).toBe("forms");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["forms", "coverage", "strategy", "offline"]),
    );
  });
});
