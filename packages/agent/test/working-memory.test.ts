import { describe, expect, it } from "vitest";
import type { ContextItem } from "../src";
import {
  assembleStepContext,
  excerptToolResult,
  OLDER_TOOL_DUMP_IMPORTANCE,
  PINNED_GOAL_IMPORTANCE,
  PINNED_REFLECTION_IMPORTANCE,
  PINNED_TODOS_IMPORTANCE,
  RELEVANT_OLDER_EXCERPT_IMPORTANCE,
  WORKING_REFLECTION_ITEM_ID,
  pinGoal,
  RECENT_TOOL_EXCERPT_IMPORTANCE,
  TOOL_EXCERPT_ID_PREFIX,
  todosToContextItem,
  WORKING_GOAL_ITEM_ID,
  WORKING_MEMORY_EXCERPT_CHARS,
  WORKING_TODOS_ITEM_ID,
  type WorkingTodo,
} from "../src/working-memory";

const GOAL = "Design a swerve intake that scores L4 coral";

const TODOS: WorkingTodo[] = [
  { id: "t1", label: "Research COTS intake rollers", status: "pending", sortKey: 0 },
  { id: "t2", label: "Measure bumper gap on the chassis", status: "in_progress", sortKey: 1 },
  { id: "t3", label: "Already finished sketch", status: "done", sortKey: 2 },
  { id: "t4", label: "Waiting on Onshape OAuth", status: "blocked", sortKey: 3 },
];

function dumpExcerpt(index: number, extra = "x".repeat(1800)): ContextItem {
  return excerptToolResult(
    { excerpt: `DUMP_PAYLOAD_${index}_${extra}` },
    { toolName: "web.fetch", status: "ok", index },
  );
}

describe("pinGoal + todosToContextItem", () => {
  it("pins goal at 990 and only open/in-progress/blocked todos at 980", () => {
    const goalItem = pinGoal(GOAL);
    expect(goalItem.id).toBe(WORKING_GOAL_ITEM_ID);
    expect(goalItem.type).toBe("task");
    expect(goalItem.importance).toBe(PINNED_GOAL_IMPORTANCE);
    expect(goalItem.content).toContain(GOAL);

    const todosItem = todosToContextItem(TODOS);
    expect(todosItem).not.toBeNull();
    expect(todosItem!.id).toBe(WORKING_TODOS_ITEM_ID);
    expect(todosItem!.importance).toBe(PINNED_TODOS_IMPORTANCE);
    expect(todosItem!.content).toContain("Research COTS intake rollers");
    expect(todosItem!.content).toContain("Measure bumper gap on the chassis");
    expect(todosItem!.content).toContain("Waiting on Onshape OAuth");
    expect(todosItem!.content).toContain("[pending]");
    expect(todosItem!.content).toContain("[in_progress]");
    expect(todosItem!.content).toContain("[blocked]");
    expect(todosItem!.content).not.toContain("Already finished sketch");
    expect(todosItem!.content).not.toContain("[done]");
  });

  it("returns null when every todo is done", () => {
    expect(todosToContextItem([{ id: "d1", label: "Shipped the brief", status: "done" }])).toBeNull();
  });
});

describe("excerptToolResult", () => {
  it("is extractive: keeps source text and does not invent facts", () => {
    const source =
      "Statbotics lists 254 EPA 72.4 at week 5 of 2018 — hatch-and-cargo cycle times were scouted, not guessed.";
    const item = excerptToolResult(
      { excerpt: source, commentary: "This team is elite and will dominate worlds" },
      { toolName: "web.fetch", status: "ok", index: 0 },
    );
    expect(item.id.startsWith(TOOL_EXCERPT_ID_PREFIX)).toBe(true);
    expect(item.content).toContain(source);
    expect(item.content).toContain("tool: web.fetch");
    expect(item.content).toContain("status: ok");
    expect(item.content).not.toContain("will dominate worlds");
    expect(item.content).not.toMatch(/recommend|projected winner|world-class/i);
  });

  it("stringifies objects without excerpt fields and still invents nothing", () => {
    const item = excerptToolResult({ data: { team: 254, epa: 45.2 } }, { toolName: " TBA.team " });
    expect(item.content).toContain("254");
    expect(item.content).toContain("45.2");
    expect(item.content).not.toMatch(/strong|dominant|best-in-class/i);
  });

  it("caps long dumps at the 8k autonomous excerpt budget without rewriting them", () => {
    const long = "ALPHA".repeat(3_000);
    const item = excerptToolResult(long);
    expect(long.length).toBeGreaterThan(WORKING_MEMORY_EXCERPT_CHARS);
    expect(item.content.startsWith(long.slice(0, WORKING_MEMORY_EXCERPT_CHARS))).toBe(true);
    expect(item.content.length).toBeLessThanOrEqual(WORKING_MEMORY_EXCERPT_CHARS + 1);
    expect(item.content.endsWith("…")).toBe(true);
  });
});

describe("assembleStepContext", () => {
  it("keeps goal and open todos when tool dumps overflow the budget", () => {
    const dumps = Array.from({ length: 24 }, (_, index) => dumpExcerpt(index));
    const assembled = assembleStepContext({
      goal: GOAL,
      todos: TODOS,
      toolExcerpts: dumps,
      tokenBudget: 400,
    });

    expect(assembled.compacted).toBe(true);
    expect(assembled.items[0]?.id).toBe(WORKING_GOAL_ITEM_ID);
    expect(assembled.items[0]?.content).toContain(GOAL);
    expect(assembled.items[0]?.importance).toBe(PINNED_GOAL_IMPORTANCE);

    const todosItem = assembled.items.find((item) => item.id === WORKING_TODOS_ITEM_ID);
    expect(todosItem).toBeDefined();
    expect(todosItem!.importance).toBe(PINNED_TODOS_IMPORTANCE);
    expect(todosItem!.content).toContain("Research COTS intake rollers");
    expect(todosItem!.content).toContain("Measure bumper gap on the chassis");
    expect(todosItem!.content).toContain("Waiting on Onshape OAuth");
    expect(todosItem!.content).not.toContain("Already finished sketch");

    const droppedOpen = [GOAL, "Research COTS intake rollers", "Measure bumper gap"].some(
      (needle) => !assembled.items.some((item) => item.content.includes(needle)),
    );
    expect(droppedOpen).toBe(false);
  });

  it("returns goal then todos then the compacted rest", () => {
    const session: ContextItem = {
      type: "module_data",
      id: "org-session",
      importance: 950,
      content: "Organization: Vantage Robotics",
    };
    const excerpt = excerptToolResult("Team 1678 ran a 4-wheel swerve in 2018.", {
      toolName: "web.search",
      index: 0,
    });
    const assembled = assembleStepContext({
      goal: GOAL,
      todos: TODOS,
      items: [session],
      toolExcerpts: [excerpt],
      tokenBudget: 8_000,
    });

    expect(assembled.items.map((item) => item.id).slice(0, 2)).toEqual([
      WORKING_GOAL_ITEM_ID,
      WORKING_TODOS_ITEM_ID,
    ]);
    expect(assembled.items.slice(2).some((item) => item.id === "org-session")).toBe(true);
    expect(assembled.items.slice(2).some((item) => item.id.startsWith(TOOL_EXCERPT_ID_PREFIX))).toBe(
      true,
    );
    expect(assembled.items[0]).not.toBe(assembled.items[1]);
  });

  it("pins extractive reflection below todos on hop 6 without dropping the goal", () => {
    const excerpts = [
      excerptToolResult("WCP sells 2 inch compliant wheels for intakes", {
        toolName: "web.search",
        index: 0,
      }),
    ];
    const assembled = assembleStepContext({
      goal: GOAL,
      todos: TODOS,
      toolExcerpts: excerpts,
      tokenBudget: 50_000,
      hopIndex: 6,
    });
    expect(assembled.items[0]?.id).toBe(WORKING_GOAL_ITEM_ID);
    expect(assembled.items[1]?.id).toBe(WORKING_TODOS_ITEM_ID);
    const reflection = assembled.items.find((item) => item.id === WORKING_REFLECTION_ITEM_ID);
    expect(reflection).toBeDefined();
    expect(reflection!.importance).toBe(PINNED_REFLECTION_IMPORTANCE);
    expect(reflection!.content).toContain("WCP sells 2 inch compliant wheels for intakes");
    expect(reflection!.content).toContain("Research COTS intake rollers");
    expect(reflection!.content).not.toMatch(/94\.2%|EPA 99|win probability/i);
    expect(assembled.items.some((item) => item.content.includes(GOAL))).toBe(true);
  });

  it("promotes an older excerpt that overlaps the goal above unrelated dumps", () => {
    const excerpts = [
      excerptToolResult("Cafeteria lunch schedule and weather notes", { toolName: "web.fetch", index: 0 }),
      excerptToolResult("Andymark COTS intake rollers on a swerve chassis", {
        toolName: "web.search",
        index: 1,
      }),
      excerptToolResult("unrelated recency a", { toolName: "web.search", index: 2 }),
      excerptToolResult("unrelated recency b", { toolName: "web.search", index: 3 }),
      excerptToolResult("unrelated recency c", { toolName: "web.search", index: 4 }),
    ];
    const assembled = assembleStepContext({
      goal: GOAL,
      todos: TODOS,
      toolExcerpts: excerpts,
      tokenBudget: 50_000,
    });
    const ranked = assembled.items.filter((item) => item.id.startsWith(TOOL_EXCERPT_ID_PREFIX));
    const relevant = ranked.find((item) => item.content.includes("Andymark COTS intake rollers"));
    const dump = ranked.find((item) => item.content.includes("Cafeteria lunch schedule"));
    expect(relevant?.importance).toBe(RELEVANT_OLDER_EXCERPT_IMPORTANCE);
    expect(dump?.importance).toBe(OLDER_TOOL_DUMP_IMPORTANCE);
    expect(ranked.filter((item) => item.importance === RECENT_TOOL_EXCERPT_IMPORTANCE)).toHaveLength(3);
  });

  it("marks only the last three tool excerpts high-importance so older dumps compact first", () => {
    const excerpts = Array.from({ length: 5 }, (_, index) =>
      excerptToolResult(`fact-${index}-verbatim-cycle-time`, {
        toolName: "web.search",
        index,
      }),
    );
    const assembled = assembleStepContext({
      goal: GOAL,
      todos: [{ id: "t1", label: "Cite current FRC COTS", status: "pending" }],
      toolExcerpts: excerpts,
      tokenBudget: 50_000,
    });

    const ranked = assembled.items.filter((item) => item.id.startsWith(TOOL_EXCERPT_ID_PREFIX));
    expect(ranked).toHaveLength(5);
    const high = ranked.filter((item) => item.importance === RECENT_TOOL_EXCERPT_IMPORTANCE);
    const low = ranked.filter((item) => item.importance === OLDER_TOOL_DUMP_IMPORTANCE);
    expect(high).toHaveLength(3);
    expect(low).toHaveLength(2);
    expect(high.every((item) => /fact-[2-4]-verbatim/.test(item.content))).toBe(true);
    expect(low.every((item) => /fact-[0-1]-verbatim/.test(item.content))).toBe(true);
  });
});
