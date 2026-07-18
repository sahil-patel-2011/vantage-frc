import { describe, expect, it } from "vitest";
import {
  RETRO_RELATED_INCLUDE,
  classifyRetroShell,
  formatRetroMetric,
  isRetroBoardEmpty,
  retroNextActions,
  retroRelatedLinks,
  retroSetupSteps,
  retroShellCopy,
  shouldShowRetroSummaryTiles,
} from "./retro-related";

describe("retroRelatedLinks", () => {
  it("builds Messages / FMEA / Decisions via hubHref / withOrgHref", () => {
    const links = retroRelatedLinks("org-1", {
      include: [...RETRO_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["messages", "fmea", "decisions"]);
    expect(links.find((l) => l.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "decisions")?.href).toBe("/decisions?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(retroRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("retroSetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO metrics", () => {
    const steps = retroSetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(steps.find((s) => s.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
    expect(steps.find((s) => s.id === "decisions")?.href).toBe("/decisions?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Retro Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatRetroMetric(3, true)).toBe("3");
    expect(formatRetroMetric(0, false)).toBe("…");
    expect(formatRetroMetric(-1, true)).toBe("0");
  });

  it("hides summary tiles without real board activity", () => {
    expect(shouldShowRetroSummaryTiles({ sessionCount: 0, itemCount: 0, openActionCount: 0 })).toBe(
      false,
    );
    expect(shouldShowRetroSummaryTiles({ sessionCount: 1, itemCount: 0, openActionCount: 0 })).toBe(
      false,
    );
    expect(shouldShowRetroSummaryTiles({ sessionCount: 1, itemCount: 2, openActionCount: 0 })).toBe(
      true,
    );
  });

  it("treats zero sessions as empty", () => {
    expect(isRetroBoardEmpty({ sessionCount: 0 })).toBe(true);
    expect(isRetroBoardEmpty({ sessionCount: 2 })).toBe(false);
  });
});

describe("classifyRetroShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO metrics", () => {
    expect(classifyRetroShell({ loading: true })).toBe("loading");
    expect(classifyRetroShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyRetroShell({ status: "setup_required" })).toBe("setup");
    expect(classifyRetroShell({ orgId: null, status: "live" })).toBe("setup");
    expect(classifyRetroShell({ orgId: "o", status: "live", sessionCount: 0 })).toBe("empty");
    expect(classifyRetroShell({ orgId: "o", status: "live", sessionCount: 1 })).toBe("ready");
  });
});

describe("retroShellCopy", () => {
  it("refuses invented DEMO metrics in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = retroShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(retroShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(retroShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("retroNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = retroNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "messages")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
  });

  it("empty shell points at session + Messages / FMEA / Decisions", () => {
    const actions = retroNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
    });
    expect(actions[0]?.id).toBe("session");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["messages", "fmea", "decisions"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("ready boards prioritize open actions without DEMO metrics", () => {
    const actions = retroNextActions({
      orgId: "org-1",
      shell: "ready",
      sessionCount: 2,
      openActionCount: 3,
    });
    expect(actions[0]?.id).toBe("actions");
    expect(actions.some((a) => a.id === "decisions")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
