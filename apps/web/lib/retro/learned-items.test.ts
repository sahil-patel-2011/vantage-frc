import { describe, expect, it } from "vitest";
import {
  buildPlaybookBody,
  collectLearnedItems,
  filterLearnedItems,
  parseHandoffTarget,
  parseRetroSourceId,
  playbookSlugForSeason,
  playbookTitleForSeason,
  retroSourceMarker,
  seasonReportLessonDrafts,
} from "./learned-items";
import type { RetroLearnedItem } from "./types";

function item(overrides: Partial<RetroLearnedItem> & Pick<RetroLearnedItem, "id" | "content">): RetroLearnedItem {
  return {
    sessionId: "s1",
    sessionTitle: "Week 3 retro",
    kind: "start",
    authorName: "Ada",
    voteCount: 0,
    createdAt: "2026-01-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("collectLearnedItems", () => {
  it("keeps only real non-empty retro rows and never invents content", () => {
    const items = collectLearnedItems([
      item({ id: "i1", content: "Start doing standups", voteCount: 1 }),
      item({ id: "i2", content: "   ", kind: "stop" }),
      { id: "", content: "ghost lesson" },
      { id: "i3", content: null },
      item({ id: "i4", content: "Stop skipping CAD review", kind: "stop", voteCount: 3, createdAt: "2026-01-18T11:00:00.000Z" }),
    ]);

    expect(items.map((row) => row.id)).toEqual(["i4", "i1"]);
    expect(items.map((row) => row.content)).toEqual(["Stop skipping CAD review", "Start doing standups"]);
    expect(items.every((row) => row.content.trim().length > 0)).toBe(true);
    expect(JSON.stringify(items)).not.toMatch(/DEMO/i);
    expect(items.some((row) => /communicate more|start earlier/i.test(row.content))).toBe(false);
  });

  it("returns an empty list when the season has no written items", () => {
    expect(collectLearnedItems([])).toEqual([]);
    expect(collectLearnedItems([{ id: "x", content: "\n\t" }])).toEqual([]);
  });
});

describe("filterLearnedItems", () => {
  it("returns the full list when no ids are requested, and never invents a missing id", () => {
    const items = [item({ id: "i1", content: "A" }), item({ id: "i2", content: "B" })];
    expect(filterLearnedItems(items, null).map((row) => row.id)).toEqual(["i1", "i2"]);
    expect(filterLearnedItems(items, ["i2", "missing"]).map((row) => row.id)).toEqual(["i2"]);
    expect(filterLearnedItems(items, ["missing"])).toEqual([]);
  });
});

describe("seasonReportLessonDrafts", () => {
  it("maps each real item to a lessons entry with a source marker", () => {
    const drafts = seasonReportLessonDrafts([
      item({ id: "i1", content: "Start doing standups", kind: "start" }),
      item({ id: "i2", content: "Stop skipping CAD review", kind: "stop" }),
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.category === "lessons")).toBe(true);
    expect(drafts[0]?.sentiment).toBe("positive");
    expect(drafts[1]?.sentiment).toBe("negative");
    expect(drafts[0]?.detail).toContain("Start doing standups");
    expect(drafts[0]?.detail).toContain(retroSourceMarker("i1"));
    expect(parseRetroSourceId(drafts[0]?.detail)).toBe("i1");
    expect(drafts.some((draft) => /never skip standups again/i.test(draft.title))).toBe(false);
  });

  it("produces no season-report drafts when there are no learned items", () => {
    expect(seasonReportLessonDrafts([])).toEqual([]);
  });
});

describe("buildPlaybookBody", () => {
  it("returns null instead of inventing a lesson when the list is empty", () => {
    expect(buildPlaybookBody({ seasonYear: 2026, items: [] })).toBeNull();
    expect(
      buildPlaybookBody({
        seasonYear: 2026,
        items: [item({ id: "blank", content: "   " })],
      }),
    ).toBeNull();
  });

  it("writes only recorded kinds and quotes the author's text", () => {
    const body = buildPlaybookBody({
      seasonYear: 2026,
      items: [
        item({ id: "i1", content: "Start doing standups", kind: "start" }),
        item({ id: "i2", content: "Keep the CAD review", kind: "continue", sessionTitle: "Champs" }),
      ],
    });
    expect(body).toContain("# 2026 retro lessons");
    expect(body).toContain("Start doing standups");
    expect(body).toContain("Keep the CAD review (Champs)");
    expect(body).toContain("## Start");
    expect(body).toContain("## Continue");
    expect(body).not.toContain("## Stop");
    expect(body).not.toMatch(/DEMO/i);
    expect(body).not.toMatch(/we should communicate better/i);
  });
});

describe("handoff helpers", () => {
  it("parses targets and builds a stable playbook slug", () => {
    expect(parseHandoffTarget("playbook")).toBe("playbook");
    expect(parseHandoffTarget("season-report")).toBe("season-report");
    expect(parseHandoffTarget("nope")).toBe("both");
    expect(playbookSlugForSeason(2026)).toBe("retro-lessons-2026");
    expect(playbookTitleForSeason(2026)).toBe("2026 retro lessons");
    expect(playbookSlugForSeason(2026)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
