import { describe, expect, it } from "vitest";
import {
  MY_DAY_RELATED_INCLUDE,
  classifyMyDayShell,
  formatMyDayMatchCount,
  isMyDayScheduleEmpty,
  myDayNextActions,
  myDayRelatedLinks,
  myDaySetupSteps,
  myDayShellCopy,
} from "./my-day-related";

describe("myDayRelatedLinks", () => {
  it("builds Event Day / Schedule / Strategy via hubHref / withOrgHref", () => {
    const links = myDayRelatedLinks("org-1", {
      include: [...MY_DAY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "schedule", "strategy"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(links.find((l) => l.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(myDayRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("myDaySetupSteps", () => {
  it("keeps Set the event; Event Day / Schedule / Strategy live on the related strip", () => {
    const steps = myDaySetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(JSON.stringify(steps)).not.toMatch(/Blue Alliance|TBA/);
  });

  it("no-org setup is only Choose your team", () => {
    expect(myDaySetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });
});

describe("My Day Soft-UI metrics", () => {
  it("formats real match counts only", () => {
    expect(formatMyDayMatchCount(8, true)).toBe("8");
    expect(formatMyDayMatchCount(0, false)).toBe("…");
    expect(formatMyDayMatchCount(-1, true)).toBe("0");
  });

  it("treats no schedule / no upcoming as empty", () => {
    expect(isMyDayScheduleEmpty({ emptyReason: "no_schedule" })).toBe(true);
    expect(isMyDayScheduleEmpty({ emptyReason: "no_upcoming" })).toBe(true);
    expect(isMyDayScheduleEmpty({ ourMatchCount: 0 })).toBe(true);
    expect(isMyDayScheduleEmpty({ ourMatchCount: 2, emptyReason: null })).toBe(false);
  });
});

describe("classifyMyDayShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO matches", () => {
    expect(classifyMyDayShell({ loading: true })).toBe("loading");
    expect(classifyMyDayShell({ fetchFailed: true, status: null })).toBe("error");
    expect(classifyMyDayShell({ status: "setup_required" })).toBe("setup");
    expect(
      classifyMyDayShell({ status: "ready", emptyReason: "no_schedule", ourMatchCount: 0 }),
    ).toBe("empty");
    expect(
      classifyMyDayShell({ status: "ready", emptyReason: null, ourMatchCount: 3 }),
    ).toBe("ready");
  });
});

describe("myDayShellCopy", () => {
  it("refuses invented DEMO matches in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = myDayShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(myDayShellCopy("empty").badge).toBe("No matches yet");
    expect(myDayShellCopy("empty").description).not.toMatch(/DEMO/i);
    expect(myDayShellCopy("empty", { emptyReason: "no_upcoming" }).badge).toBe(
      "No upcoming matches",
    );
    expect(myDayShellCopy("setup").badge).toBe("Needs setup");
    expect(myDayShellCopy("ready").description).not.toMatch(/DEMO/i);
    expect(myDayShellCopy("setup").description).not.toMatch(/Blue Alliance|TBA/);
    expect(myDayShellCopy("empty").description).not.toMatch(/Blue Alliance|TBA/);
    expect(myDayShellCopy("ready").description).not.toMatch(/Blue Alliance|TBA/);
  });
});

describe("myDayNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = myDayNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty boards at Event Day / Schedule / Strategy — never DEMO matches", () => {
    const actions = myDayNextActions({
      orgId: "org-1",
      shell: "empty",
      emptyReason: "no_schedule",
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["command", "schedule", "strategy"]),
    );
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
    expect(actions.every((a) => !/DEMO/i.test(a.detail))).toBe(true);
    expect(actions.find((a) => a.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(actions.find((a) => a.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("ready boards prioritize Scout this match", () => {
    const actions = myDayNextActions({ orgId: "org-1", shell: "ready" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["scouting", "command", "schedule", "strategy"]),
    );
    expect(JSON.stringify(actions)).not.toMatch(/Blue Alliance|TBA/);
  });
});
