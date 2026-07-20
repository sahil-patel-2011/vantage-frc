import { describe, expect, it } from "vitest";
import {
  EVENT_DAY_RELATED_INCLUDE,
  classifyEventDayShell,
  eventDayRelatedLinks,
  eventDaySetupSteps,
  eventDayShellCopy,
  eventDayShellNextActions,
  formatEventDayMatchCount,
  isEventDayScheduleEmpty,
} from "./event-day-related";

describe("eventDayRelatedLinks", () => {
  it("builds My Day / Schedule / Strategy / Logistics via hubHref / withOrgHref", () => {
    const links = eventDayRelatedLinks("org-1", {
      include: [...EVENT_DAY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["my-day", "schedule", "strategy", "logistics"]);
    expect(links.find((l) => l.id === "my-day")?.href).toBe(
      "/competition?tab=my-day&orgId=org-1",
    );
    expect(links.find((l) => l.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "logistics")?.href).toBe("/logistics?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(eventDayRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("eventDaySetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO schedule", () => {
    const steps = eventDaySetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "team-data")?.href).toBe("/team/data?orgId=org-1");
    expect(steps.find((s) => s.id === "my-day")?.href).toBe(
      "/competition?tab=my-day&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Event Day Soft-UI metrics", () => {
  it("formats real match counts only", () => {
    expect(formatEventDayMatchCount(8, true)).toBe("8");
    expect(formatEventDayMatchCount(0, false)).toBe("…");
    expect(formatEventDayMatchCount(-1, true)).toBe("0");
  });

  it("treats empty status as empty; live stays non-empty even without matches", () => {
    expect(isEventDayScheduleEmpty({ status: "empty" })).toBe(true);
    expect(isEventDayScheduleEmpty({ matchCount: 0 })).toBe(true);
    expect(isEventDayScheduleEmpty({ status: "live", matchCount: 0 })).toBe(false);
    expect(isEventDayScheduleEmpty({ status: "live", matchCount: 2 })).toBe(false);
  });
});

describe("classifyEventDayShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO schedule", () => {
    expect(classifyEventDayShell({ loading: true })).toBe("loading");
    expect(classifyEventDayShell({ fetchFailed: true, status: null, orgId: "org-1" })).toBe(
      "error",
    );
    expect(classifyEventDayShell({ orgId: null })).toBe("setup");
    expect(
      classifyEventDayShell({
        orgId: "org-1",
        status: "setup_required",
        eventKey: null,
      }),
    ).toBe("setup");
    expect(
      classifyEventDayShell({
        orgId: "org-1",
        status: "empty",
        eventKey: "2026ny",
        matchCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyEventDayShell({
        orgId: "org-1",
        status: "live",
        eventKey: "2026ny",
        matchCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("eventDayShellCopy", () => {
  it("keeps empty/setup copy concise without DEMO lectures", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = eventDayShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).not.toMatch(/\bDEMO\b/);
    }
    expect(eventDayShellCopy("empty").badge).toBe("No matches");
    expect(eventDayShellCopy("empty").description).toMatch(/TBA/i);
    expect(eventDayShellCopy("setup").badge).toBe("Setup");
    expect(eventDayShellCopy("ready").description.length).toBeLessThan(80);
  });
});

describe("eventDayShellNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = eventDayShellNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["my-day", "schedule", "strategy"]),
    );
  });

  it("points empty boards at My Day / Schedule / Strategy / Scouting", () => {
    const actions = eventDayShellNextActions({
      orgId: "org-1",
      shell: "empty",
    });
    expect(actions.map((a) => a.id)).toEqual(["schedule", "my-day", "strategy", "scouting"]);
    expect(actions.every((a) => !/\bDEMO\b/.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
    expect(actions.find((a) => a.id === "my-day")?.href).toBe(
      "/competition?tab=my-day&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(actions.find((a) => a.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(actions.find((a) => a.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("ready boards prioritize My Day with Strategy / Scouting links", () => {
    const actions = eventDayShellNextActions({ orgId: "org-1", shell: "ready" });
    expect(actions[0]?.id).toBe("my-day");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["my-day", "schedule", "strategy", "scouting"]),
    );
  });
});
