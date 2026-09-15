import { describe, expect, it } from "vitest";
import {
  PINNED_GOAL_IMPORTANCE,
  PINNED_TODOS_IMPORTANCE,
  TOOL_EXCERPT_ID_PREFIX,
  WORKING_GOAL_ITEM_ID,
  WORKING_MEMORY_EXCERPT_CHARS,
  WORKING_TODOS_ITEM_ID,
  type ContextItem,
} from "@vantage/agent";
import type { CadAgentStep } from "@vantage/cad";
import {
  assembleCadHopContext,
  CAD_HOP_CHECKPOINT_ASSISTANT,
  CAD_PARENT_HANDOFF_ID_PREFIX,
  cadWorkingTodoLabels,
  checkpointCadSessionMessages,
  createChildToolExcerpts,
  excerptCadToolResult,
  isParentTaskHandoff,
  parentTaskHandoff,
  parseParentTaskHandoff,
  pinCadBriefAndPlan,
  reopenCadHopTransaction,
  workingStatusFromCadTask,
} from "./cad-agent-checkpoint";

const HUGE_CAD_JSON = {
  featureId: "Fabc",
  entities: Array.from({ length: 80 }, (_, index) => ({
    id: `e${index}`,
    vertices: [0, 1, 2, 3, 4, 5],
    dump: "VERTEX_CLOUD_".repeat(40),
  })),
};

const STEP: CadAgentStep = {
  index: 1,
  tool: "onshape_sketch_rectangle",
  label: "Sketch rectangle",
  title: "Sketched 80×40 mm plate",
  detail: "80 mm × 40 mm",
  status: "done",
  featureId: "Fabc",
  at: "2026-09-14T00:00:00.000Z",
};

function childDumpIds(items: readonly ContextItem[]): string[] {
  return items.filter((item) => item.id.startsWith(TOOL_EXCERPT_ID_PREFIX)).map((item) => item.id);
}

describe("pinCadBriefAndPlan", () => {
  it("pins the user brief and approved plan steps together", () => {
    const goal = pinCadBriefAndPlan("6 mm plate 80×40 with 4× ⌀5 holes", {
      brief: "6 mm plate 80×40 with 4× ⌀5 holes",
      approved: true,
      steps: [
        { index: 1, title: "Sketch the plate", detail: "80×40 mm" },
        { index: 2, title: "Extrude 6 mm", detail: "" },
      ],
    });
    expect(goal).toContain("6 mm plate 80×40");
    expect(goal).toContain("Approved plan:");
    expect(goal).toContain("1. Sketch the plate — 80×40 mm");
    expect(goal).toContain("2. Extrude 6 mm");
  });

  it("does not treat a draft plan as pinned", () => {
    const goal = pinCadBriefAndPlan("intake roller", {
      brief: "intake roller",
      approved: false,
      steps: [{ index: 1, title: "Sketch roller", detail: "" }],
    });
    expect(goal).toBe("intake roller");
    expect(goal).not.toContain("Approved plan:");
  });
});

describe("assembleCadHopContext", () => {
  it("pins brief/plan at goal importance and open CAD todos next", () => {
    const items = assembleCadHopContext({
      brief: "6 mm plate",
      plan: {
        brief: "6 mm plate",
        approved: true,
        steps: [{ index: 1, title: "Sketch plate", detail: "" }],
      },
      todos: [
        { id: "t1", label: "Sketch plate", status: "pending", sortKey: 0 },
        { id: "t2", label: "Already extruded", status: "done", sortKey: 1 },
      ],
      items: [{ type: "module_fact", id: "cad-bound-document", content: "bound", importance: 700 }],
      tokenBudget: 2_000,
    });
    expect(items[0]?.id).toBe(WORKING_GOAL_ITEM_ID);
    expect(items[0]?.importance).toBe(PINNED_GOAL_IMPORTANCE);
    expect(items[0]?.content).toContain("6 mm plate");
    expect(items[0]?.content).toContain("Sketch plate");
    expect(items[1]?.id).toBe(WORKING_TODOS_ITEM_ID);
    expect(items[1]?.importance).toBe(PINNED_TODOS_IMPORTANCE);
    expect(items[1]?.content).toContain("Sketch plate");
    expect(items[1]?.content).not.toContain("Already extruded");
  });
});

describe("excerptCadToolResult", () => {
  it("clips CAD JSON through excerptToolResult instead of dumping the body", () => {
    const item = excerptCadToolResult({
      tool: "onshape_extrude",
      result: HUGE_CAD_JSON,
      ok: true,
      index: 3,
    });
    expect(item.id.startsWith(TOOL_EXCERPT_ID_PREFIX)).toBe(true);
    expect(item.content).toContain("tool: onshape_extrude");
    expect(item.content).toContain("status: ok");
    expect(item.content).toContain("Fabc");
    expect(item.content.length).toBeLessThanOrEqual(WORKING_MEMORY_EXCERPT_CHARS + 80);
    expect(item.content.length).toBeLessThan(JSON.stringify(HUGE_CAD_JSON).length);
  });
});

describe("multitask parent vs child isolation", () => {
  it("gives each sub-task a fresh excerpt array", () => {
    const first = createChildToolExcerpts();
    const second = createChildToolExcerpts();
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(first).not.toBe(second);
    first.push(
      excerptCadToolResult({
        tool: "onshape_sketch_rectangle",
        result: { dump: "CHILD_ONE_SKETCH_MESH" },
        ok: true,
        index: 0,
      }),
    );
    expect(second).toEqual([]);
    expect(first[0]?.content).toContain("CHILD_ONE_SKETCH_MESH");
  });

  it("appends only {taskId, summary, ok} to the parent — not child dumps", () => {
    const child = createChildToolExcerpts();
    child.push(
      excerptCadToolResult({
        tool: "onshape_extrude",
        result: { dump: "CHILD_EXTRUDE_DUMP", entities: ["secret-face-id"] },
        ok: true,
        index: 0,
      }),
    );
    const parent: ContextItem[] = [];
    parent.push(
      parentTaskHandoff({
        taskId: "t1",
        summary: "Extruded the 6 mm plate.",
        ok: true,
      }),
    );

    expect(parent).toHaveLength(1);
    expect(isParentTaskHandoff(parent[0]!)).toBe(true);
    expect(parent[0]!.id).toBe(`${CAD_PARENT_HANDOFF_ID_PREFIX}t1`);
    expect(parseParentTaskHandoff(parent[0]!)).toEqual({
      taskId: "t1",
      summary: "Extruded the 6 mm plate.",
      ok: true,
    });
    expect(Object.keys(JSON.parse(parent[0]!.content) as object).sort()).toEqual(["ok", "summary", "taskId"]);
    expect(parent[0]!.content).not.toContain("CHILD_EXTRUDE_DUMP");
    expect(parent[0]!.content).not.toContain("secret-face-id");
    for (const dumpId of childDumpIds(child)) {
      expect(parent.map((item) => item.id)).not.toContain(dumpId);
    }
  });
});

describe("checkpointCadSessionMessages", () => {
  it("keeps the user brief and a step summary so a cutoff still has the build log", () => {
    const messages = checkpointCadSessionMessages({
      history: [{ role: "user", text: "earlier bind" }],
      userText: "Make an 80×40 plate",
      steps: [STEP],
    });
    expect(messages[0]).toEqual({ role: "user", text: "earlier bind" });
    expect(messages.some((row) => row.role === "user" && row.text === "Make an 80×40 plate")).toBe(true);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.text).toContain("1 step completed");
    expect(messages.at(-1)?.text).not.toBe(CAD_HOP_CHECKPOINT_ASSISTANT);
  });

  it("uses the working placeholder when no tools have run yet", () => {
    const messages = checkpointCadSessionMessages({
      history: [],
      userText: "Make an 80×40 plate",
      steps: [],
    });
    expect(messages.at(-1)).toEqual({ role: "assistant", text: CAD_HOP_CHECKPOINT_ASSISTANT });
  });
});

describe("cadWorkingTodoLabels + workingStatusFromCadTask", () => {
  it("seeds unique labels from plan steps and task titles", () => {
    expect(
      cadWorkingTodoLabels({
        plan: { steps: [{ title: "Sketch plate" }, { title: "Sketch plate" }, { title: "Extrude 6 mm" }] },
        tasks: [{ title: "Fillet corners" }, { title: " " }],
      }),
    ).toEqual(["Sketch plate", "Extrude 6 mm", "Fillet corners"]);
  });

  it("maps CAD task status onto working-todo status without inventing done", () => {
    expect(workingStatusFromCadTask("pending")).toBe("pending");
    expect(workingStatusFromCadTask("in_progress")).toBe("in_progress");
    expect(workingStatusFromCadTask("done")).toBe("done");
    expect(workingStatusFromCadTask("failed")).toBe("blocked");
  });
});

describe("reopenCadHopTransaction", () => {
  it("COMMITs the hop then re-opens RLS SET LOCAL", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
    };
    await reopenCadHopTransaction(client as never, "user-1", "org-1");
    expect(queries[0]?.sql).toBe("COMMIT");
    expect(queries[1]?.sql).toBe("BEGIN");
    expect(queries[2]?.sql).toContain("set_config('app.user_id'");
    expect(queries[2]?.params).toEqual(["user-1"]);
    expect(queries[3]?.sql).toContain("set_config('app.org_id'");
    expect(queries[3]?.params).toEqual(["org-1"]);
  });
});
