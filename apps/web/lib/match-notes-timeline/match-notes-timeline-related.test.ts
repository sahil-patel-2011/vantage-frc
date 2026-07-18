import { describe, expect, it } from "vitest";
import {
  MATCH_NOTES_TIMELINE_RELATED_INCLUDE,
  classifyMatchNotesTimelineShell,
  formatMatchNotesMetric,
  matchNotesTimelineNextActions,
  matchNotesTimelineRelatedLinks,
  matchNotesTimelineShellCopy,
  shouldShowMatchNotesSummaryTiles,
} from "./match-notes-timeline-related";

describe("matchNotesTimelineRelatedLinks", () => {
  it("builds Schedule / Strategy / Scouting cross-links", () => {
    const links = matchNotesTimelineRelatedLinks("org-1", {
      include: [...MATCH_NOTES_TIMELINE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["schedule", "strategy", "scouting"]);
    expect(links.find((l) => l.id === "schedule")?.href).toBe("/schedule?orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = matchNotesTimelineRelatedLinks("org-1", {
      active: "schedule",
      include: ["strategy", "scouting", "match-checklist"],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "scouting", "match-checklist"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(matchNotesTimelineRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("matchNotesTimelineNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = matchNotesTimelineNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "schedule")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Workspace + Schedule / Strategy / Scouting", () => {
    const actions = matchNotesTimelineNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "schedule")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log-note + Schedule / Strategy / Scouting", () => {
    const actions = matchNotesTimelineNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log-note", "schedule", "strategy", "scouting"]),
    );
    expect(actions[0]?.href).toBe("#match-notes-timeline-log");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize timelines without DEMO metrics", () => {
    const actions = matchNotesTimelineNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 3,
      matchCount: 2,
    });
    expect(actions[0]?.id).toBe("review-timelines");
    expect(actions.some((a) => a.id === "schedule")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyMatchNotesTimelineShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyMatchNotesTimelineShell({ loading: true })).toBe("loading");
    expect(classifyMatchNotesTimelineShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyMatchNotesTimelineShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyMatchNotesTimelineShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyMatchNotesTimelineShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyMatchNotesTimelineShell({
        loading: false,
        orgId: "o1",
        status: "live",
        entryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("matchNotesTimelineShellCopy + format helpers", () => {
  it("refuses invented DEMO match metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = matchNotesTimelineShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent|log|clock/i);
    }
    expect(matchNotesTimelineShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(matchNotesTimelineShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatMatchNotesMetric(null, false)).toBe("…");
    expect(formatMatchNotesMetric(3, true)).toBe("3");
    expect(formatMatchNotesMetric(-1, true)).toBe("0");
    expect(shouldShowMatchNotesSummaryTiles(0)).toBe(false);
    expect(shouldShowMatchNotesSummaryTiles(2)).toBe(true);
  });
});
