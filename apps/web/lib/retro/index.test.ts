import { describe, expect, it } from "vitest";
import {
  buildPlaybookBody,
  buildPostmortemNarrative,
  collectLearnedItems,
  countItemsByKind,
  groupItemsByKind,
} from ".";
import type { RetroItem, RetroPostmortemCounts } from "./types";

const emptyCounts = (): RetroPostmortemCounts => ({
  decisionsTotal: 0,
  decisionsAccepted: 0,
  decisionsRejected: 0,
  risksTotal: 0,
  risksOpen: 0,
  risksClosed: 0,
  incidentsTotal: 0,
  incidentsBySeverity: [],
  fmeaFailuresTotal: 0,
  fmeaTopFailures: [],
  retroActionItemsTotal: 0,
  retroActionItemsOpen: 0,
});

describe("buildPostmortemNarrative", () => {
  it("states absences instead of inventing lessons when nothing is logged", () => {
    const narrative = buildPostmortemNarrative({ seasonYear: 2026, counts: emptyCounts() });
    expect(narrative).toContain("2026");
    expect(narrative).toContain("no decisions logged");
    expect(narrative).toContain("no retro action items recorded");
    expect(narrative).not.toMatch(/DEMO/i);
    expect(narrative).not.toMatch(/we learned to communicate/i);
  });
});

describe("groupItemsByKind", () => {
  it("groups only the items passed in", () => {
    const items: RetroItem[] = [
      {
        id: "i1",
        sessionId: "s1",
        kind: "start",
        content: "Start doing standups",
        authorName: "Ada",
        voteCount: 2,
        votedByMe: false,
        createdAt: "2026-01-18T12:00:00.000Z",
      },
    ];
    const grouped = groupItemsByKind(items);
    expect(grouped.start).toHaveLength(1);
    expect(grouped.stop).toHaveLength(0);
    expect(grouped.continue).toHaveLength(0);
    expect(countItemsByKind(items)).toEqual({ start: 1, stop: 0, continue: 0 });
  });
});

describe("public learned-item exports", () => {
  it("re-export collectLearnedItems / buildPlaybookBody without inventing rows", () => {
    expect(collectLearnedItems([])).toEqual([]);
    expect(buildPlaybookBody({ seasonYear: 2026, items: [] })).toBeNull();
  });
});
