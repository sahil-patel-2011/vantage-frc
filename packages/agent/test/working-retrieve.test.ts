import { describe, expect, it } from "vitest";
import type { ContextItem } from "../src";
import {
  extractiveReflection,
  memoryHitsForQuery,
  scoreExcerptAgainstGoal,
  selectWorkingEvidence,
  shouldReflectOnHop,
  tokenizeGoal,
} from "../src/working-retrieve";
import type { WorkingTodo } from "../src/working-memory";

const GOAL = "Design a swerve intake that scores L4 coral";

const TODOS: WorkingTodo[] = [
  { id: "t1", label: "Research COTS intake rollers", status: "pending" },
  { id: "t2", label: "Already finished sketch", status: "done" },
];

function fact(id: string, content: string): ContextItem {
  return { type: "module_fact", id, content, importance: 40 };
}

describe("tokenizeGoal + scoreExcerptAgainstGoal", () => {
  it("ranks an excerpt that shares goal tokens above an unrelated dump", () => {
    const tokens = tokenizeGoal(GOAL);
    expect(tokens).toContain("swerve");
    expect(tokens).toContain("intake");
    expect(tokens).toContain("l4");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("that");

    const relevant = fact("e-relevant", "WCP swerve modules plus COTS intake rollers for L4");
    const dump = fact("e-dump", "Cafeteria lunch schedule and weather notes");
    expect(scoreExcerptAgainstGoal(relevant, GOAL, TODOS)).toBeGreaterThan(
      scoreExcerptAgainstGoal(dump, GOAL, TODOS),
    );
    expect(scoreExcerptAgainstGoal(dump, GOAL, TODOS)).toBe(0);
  });
});

describe("selectWorkingEvidence", () => {
  it("prefers an older excerpt that shares goal tokens", () => {
    const excerpts = [
      fact("old-dump", "Pit cart inventory: zip ties and gaffer tape"),
      fact("old-relevant", "Andymark COTS intake rollers on a swerve chassis"),
      fact("old-noise", "Hotel shuttle leaves at dawn"),
      fact("recent-a", "zzzz low-overlap note one"),
      fact("recent-b", "yyyy low-overlap note two"),
      fact("recent-c", "xxxx low-overlap note three"),
    ];
    const selected = selectWorkingEvidence({
      goal: GOAL,
      todos: TODOS,
      excerpts,
      recentCount: 3,
      relevantCount: 4,
    });

    expect(selected.relevant.map((item) => item.id)).toContain("old-relevant");
    expect(selected.relevant.map((item) => item.id)).not.toContain("old-dump");
    expect(selected.selected.some((item) => item.content.includes("Andymark COTS intake rollers"))).toBe(
      true,
    );
    expect(selected.selected.every((item) => excerpts.includes(item))).toBe(true);
  });

  it("keeps the last-3 recency excerpts even if they have low overlap", () => {
    const excerpts = [
      fact("old-relevant", "swerve intake L4 coral scoring notes from the brief"),
      fact("recent-a", "unrelated alpha dump"),
      fact("recent-b", "unrelated beta dump"),
      fact("recent-c", "unrelated gamma dump"),
    ];
    const selected = selectWorkingEvidence({
      goal: GOAL,
      todos: TODOS,
      excerpts,
      recentCount: 3,
      relevantCount: 4,
    });

    expect(selected.recent.map((item) => item.id)).toEqual(["recent-a", "recent-b", "recent-c"]);
    expect(selected.recent.every((item) => item.content.includes("unrelated"))).toBe(true);
    expect(selected.selected.map((item) => item.id)).toEqual([
      "old-relevant",
      "recent-a",
      "recent-b",
      "recent-c",
    ]);
  });

  it("returns an empty selection when excerpts are empty — no invented rows", () => {
    const selected = selectWorkingEvidence({
      goal: GOAL,
      todos: TODOS,
      excerpts: [],
    });
    expect(selected).toEqual({ recent: [], relevant: [], selected: [] });
    expect(selected.selected).toHaveLength(0);
  });
});

describe("extractiveReflection", () => {
  it("quotes only substrings from inputs and never fabricates a metric", () => {
    const excerpts = [
      fact("e1", "WCP sells 2 inch compliant wheels for intakes"),
      fact("e2", "Team 254 posted a swerve CAD screenshot"),
    ];
    const note = extractiveReflection(GOAL, TODOS, excerpts);
    expect(note).toMatch(/what's working/i);
    expect(note).toMatch(/still open/i);
    expect(note).toContain("WCP sells 2 inch compliant wheels for intakes");
    expect(note).toContain("Research COTS intake rollers");
    expect(note).toContain(GOAL);
    expect(note).not.toContain("Already finished sketch");
    expect(note).not.toMatch(/94\.2%|EPA 99|win probability|projected winner|invented/i);

    const sources = [GOAL, ...TODOS.map((todo) => todo.label), ...excerpts.map((item) => item.content)];
    const quoted = [...note.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(quoted.length).toBeGreaterThan(0);
    for (const quote of quoted) {
      expect(sources.some((source) => source.includes(quote))).toBe(true);
    }
  });
});

describe("memoryHitsForQuery", () => {
  it("returns existing excerpt and todo hits — does not invent text", () => {
    const excerpts = [fact("e1", "Andymark COTS intake rollers catalog page")];
    const hits = memoryHitsForQuery("COTS intake rollers", excerpts, TODOS);
    expect(hits.some((hit) => hit.kind === "excerpt" && hit.quote.includes("Andymark COTS intake"))).toBe(
      true,
    );
    expect(hits.some((hit) => hit.kind === "todo" && hit.quote.includes("Research COTS intake rollers"))).toBe(
      true,
    );
    expect(hits.every((hit) => hit.quote.length > 0)).toBe(true);
    expect(hits.some((hit) => /94\.2%|EPA 99/.test(hit.quote))).toBe(false);
  });
});

describe("shouldReflectOnHop", () => {
  it("fires every 6 hops and not on hop 0", () => {
    expect(shouldReflectOnHop(0)).toBe(false);
    expect(shouldReflectOnHop(5)).toBe(false);
    expect(shouldReflectOnHop(6)).toBe(true);
    expect(shouldReflectOnHop(12)).toBe(true);
  });
});
