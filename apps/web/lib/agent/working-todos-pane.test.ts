import { describe, expect, it } from "vitest";
import { classifyWorkingTodosPane, workingTodosPaneCopy } from "./working-todos-pane";

describe("working todos pane", () => {
  it("separates setup from an empty checklist", () => {
    expect(classifyWorkingTodosPane({ selected: false, setupRequired: true, todoCount: 0 })).toBe("hidden");
    expect(classifyWorkingTodosPane({ selected: true, setupRequired: true, todoCount: 0 })).toBe("setup");
    expect(classifyWorkingTodosPane({ selected: true, setupRequired: false, todoCount: 0 })).toBe("empty");
    expect(classifyWorkingTodosPane({ selected: true, setupRequired: false, todoCount: 2 })).toBe("ready");
    expect(workingTodosPaneCopy("setup").badge).toBe("Needs setup");
    expect(workingTodosPaneCopy("empty").title).toBe("No checklist items yet");
  });
});
