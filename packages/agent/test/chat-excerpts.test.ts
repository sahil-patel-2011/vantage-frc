import { describe, expect, it } from "vitest";
import { annotateToolOutput, toolOutputsToContextContent } from "../src/auto-tools";
import {
  assembleChatCompletionContext,
  chatWorkingTodoRunId,
} from "../src/chat-working-memory";
import {
  TOOL_EXCERPT_ID_PREFIX,
  WORKING_GOAL_ITEM_ID,
  WORKING_MEMORY_EXCERPT_CHARS,
  WORKING_MEMORY_SUMMARY_CHARS,
  WORKING_TODOS_ITEM_ID,
  type WorkingTodo,
} from "../src/working-memory";

const THREAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function hugeToolOutput() {
  const payload = "CYCLE_TIME_DUMP_".repeat(2_000);
  return annotateToolOutput(
    "reference.team",
    {
      teamKey: "frc254",
      epa: 72.4,
      dump: payload,
    },
    { teamKey: "frc254" },
  );
}

describe("chatWorkingTodoRunId", () => {
  it("uses a uuid thread id as the working-todo run id", () => {
    expect(chatWorkingTodoRunId(THREAD)).toBe(THREAD);
    expect(chatWorkingTodoRunId(`  ${THREAD}  `)).toBe(THREAD);
  });

  it("falls back to null when the thread is missing or not a uuid", () => {
    expect(chatWorkingTodoRunId(undefined)).toBeNull();
    expect(chatWorkingTodoRunId(null)).toBeNull();
    expect(chatWorkingTodoRunId("")).toBeNull();
    expect(chatWorkingTodoRunId("thread-not-a-uuid")).toBeNull();
    expect(chatWorkingTodoRunId("chat:254")).toBeNull();
  });
});

describe("toolOutputsToContextContent excerpts", () => {
  it("stores excerpt + status instead of an uncapped data dump", () => {
    const annotated = hugeToolOutput();
    const [item] = toolOutputsToContextContent([annotated]);
    expect(item).toBeDefined();
    expect(item!.id.startsWith(TOOL_EXCERPT_ID_PREFIX)).toBe(true);
    expect(item!.content).toContain("tool: reference.team");
    expect(item!.content).toContain("status: ok");
    expect(item!.content).toContain("72.4");
    expect(item!.content).toContain("CYCLE_TIME_DUMP_");
    expect(item!.content).not.toContain(`"data":`);
    expect(item!.content.length).toBeLessThan(
      WORKING_MEMORY_EXCERPT_CHARS + WORKING_MEMORY_SUMMARY_CHARS + 200,
    );
    expect(item!.content).not.toContain(String((annotated.output as { dump: string }).dump));
  });

  it("keeps extractive text from small tool results", () => {
    const annotated = annotateToolOutput(
      "web.search",
      {
        status: "ok",
        provider: "brave",
        results: [{ title: "TBA", url: "https://www.thebluealliance.com/", snippet: "x" }],
      },
      { query: "TBA" },
    );
    const [item] = toolOutputsToContextContent([annotated]);
    expect(item!.content).toContain("web.search");
    expect(item!.content).toContain("thebluealliance");
    expect(item!.content).not.toContain(`"data":`);
  });
});

describe("assembleChatCompletionContext", () => {
  it("pins the chat goal and open thread todos ahead of tool excerpts", () => {
    const todos: WorkingTodo[] = [
      { id: "t1", label: "Cite the 2018 EPA source", status: "pending", sortKey: 0 },
      { id: "t2", label: "Already filed the brief", status: "done", sortKey: 1 },
    ];
    const items = assembleChatCompletionContext({
      message: "Compare 254 to 1678",
      todos,
      toolOutputs: [hugeToolOutput()],
      tokenBudget: 8_000,
    });

    expect(items[0]?.id).toBe(WORKING_GOAL_ITEM_ID);
    expect(items[0]?.content).toContain("Compare 254 to 1678");
    const todosItem = items.find((item) => item.id === WORKING_TODOS_ITEM_ID);
    expect(todosItem).toBeDefined();
    expect(todosItem!.content).toContain("Cite the 2018 EPA source");
    expect(todosItem!.content).not.toContain("Already filed the brief");
    expect(items.some((item) => item.id.startsWith(TOOL_EXCERPT_ID_PREFIX))).toBe(true);
    expect(items.some((item) => item.content.includes(`"data":`))).toBe(false);
  });

  it("keeps open todos when a huge tool dump would overflow the budget", () => {
    const todos: WorkingTodo[] = [
      { id: "t1", label: "Keep this chat todo visible", status: "in_progress" },
    ];
    const items = assembleChatCompletionContext({
      message: "Do not drop the open todo",
      todos,
      toolOutputs: [hugeToolOutput(), hugeToolOutput()],
      tokenBudget: 400,
    });

    expect(items.some((item) => item.content.includes("Do not drop the open todo"))).toBe(true);
    expect(items.some((item) => item.content.includes("Keep this chat todo visible"))).toBe(true);
    expect(items.every((item) => item.content.length < 20_000)).toBe(true);
  });
});
