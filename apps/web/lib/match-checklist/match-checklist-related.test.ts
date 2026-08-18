import { describe, expect, it } from "vitest";
import {
  MATCH_CHECKLIST_RELATED_INCLUDE,
  countDoneItems,
  formatItemProgress,
  matchChecklistNextActions,
  shouldShowSummaryTiles,
  summaryHasTimingEvidence,
} from "./match-checklist-related";
import type { MatchChecklistRun, MatchChecklistSummary } from "./types";

function run(partial: Partial<MatchChecklistRun> & Pick<MatchChecklistRun, "id" | "matchLabel">): MatchChecklistRun {
  return {
    eventKey: null,
    teamNumber: null,
    startedAt: "2026-07-18T12:00:00.000Z",
    completedAt: null,
    items: [
      { key: "bumper", label: "Bumpers secured", done: false, checkedAt: null },
      { key: "battery", label: "Battery charged & seated", done: false, checkedAt: null },
      { key: "tether", label: "Tether / e-stop clipped", done: false, checkedAt: null },
      { key: "code", label: "Code deployed & radio linked", done: false, checkedAt: null },
    ],
    elapsedSeconds: 12,
    allDone: false,
    bumperColor: null,
    ...partial,
  };
}

describe("match checklist Soft-UI helpers", () => {
  it("requires workspace before next actions", () => {
    expect(matchChecklistNextActions({ runs: [] }).map((a) => a.id)).toEqual(["workspace"]);
  });

  it("asks to hang TBA bumper color before the first checklist — never DEMO", () => {
    const actions = matchChecklistNextActions({
      orgId: "org-1",
      runs: [],
      upcomingMatches: [{ label: "Qual 12", bumperColor: "red" }],
    });
    expect(actions[0]?.id).toBe("hang-bumpers");
    expect(actions[0]?.label).toContain("RED");
    expect(actions[0]?.label).toContain("Qual 12");
    expect(actions[0]?.detail.toLowerCase()).not.toContain("demo");
  });

  it("asks for first checklist when history is empty — never DEMO progress", () => {
    const actions = matchChecklistNextActions({ orgId: "org-1", runs: [] });
    expect(actions[0]?.id).toBe("start-run");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toContain("command");
    expect(actions.map((a) => a.id)).toContain("my-day");
    expect(actions.map((a) => a.id)).toContain("scouting");
    expect(actions.map((a) => a.id)).toContain("strategy");
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("prioritizes finishing an open run with real item counts", () => {
    const open = run({
      id: "r1",
      matchLabel: "Qualification 12",
      items: [
        { key: "bumper", label: "Bumpers secured", done: true, checkedAt: "2026-07-18T12:00:10.000Z" },
        { key: "battery", label: "Battery charged & seated", done: true, checkedAt: "2026-07-18T12:00:20.000Z" },
        { key: "tether", label: "Tether / e-stop clipped", done: false, checkedAt: null },
        { key: "code", label: "Code deployed & radio linked", done: false, checkedAt: null },
      ],
    });
    const actions = matchChecklistNextActions({ orgId: "org-1", runs: [open] });
    expect(actions[0]?.id).toBe("finish-open");
    expect(actions[0]?.detail).toContain("2 of 4");
    expect(actions[0]?.detail).not.toMatch(/demo/i);
  });

  it("formats item progress from real checks only", () => {
    expect(countDoneItems([])).toBe(0);
    expect(formatItemProgress([])).toBe("No items");
    expect(
      formatItemProgress([
        { done: true },
        { done: false },
        { done: true },
        { done: false },
      ]),
    ).toBe("2 of 4 checked");
    expect(formatItemProgress([{ done: true }, { done: true }])).toBe("All clear");
  });

  it("hides summary tiles and timing until real runs exist", () => {
    const empty: MatchChecklistSummary = {
      totalRuns: 0,
      completedRuns: 0,
      openRuns: 0,
      averageElapsedSeconds: null,
      fastestElapsedSeconds: null,
    };
    expect(shouldShowSummaryTiles(empty)).toBe(false);
    expect(summaryHasTimingEvidence(empty)).toBe(false);

    const openOnly: MatchChecklistSummary = {
      totalRuns: 1,
      completedRuns: 0,
      openRuns: 1,
      averageElapsedSeconds: null,
      fastestElapsedSeconds: null,
    };
    expect(shouldShowSummaryTiles(openOnly)).toBe(true);
    expect(summaryHasTimingEvidence(openOnly)).toBe(false);

    const completed: MatchChecklistSummary = {
      totalRuns: 2,
      completedRuns: 1,
      openRuns: 1,
      averageElapsedSeconds: 60,
      fastestElapsedSeconds: 60,
    };
    expect(summaryHasTimingEvidence(completed)).toBe(true);
  });

  it("uses focused Competition related includes without DEMO labels", () => {
    expect(MATCH_CHECKLIST_RELATED_INCLUDE).toEqual(["command", "my-day", "scouting", "strategy"]);
    expect(MATCH_CHECKLIST_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });
});
