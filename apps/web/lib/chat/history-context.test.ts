import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_MAX_TURNS,
  CHAT_HISTORY_TOKEN_BUDGET,
  buildHistoryContext,
} from "./history-context";

const turn = (id: string, role: "user" | "assistant", content: string) => ({
  id,
  role,
  content,
});

describe("buildHistoryContext", () => {
  it("sends only the new message when the thread is empty", () => {
    expect(buildHistoryContext({ turns: [], message: "Scout 254 this weekend" })).toEqual({
      history: [],
      message: "Scout 254 this weekend",
      estimatedTokens: 0,
      droppedDigest: "",
    });
    expect(buildHistoryContext({ turns: null, message: "  Hello  " }).history).toEqual([]);
    expect(buildHistoryContext({ message: "Hello" }).history).toEqual([]);
  });

  it("keeps prior user/assistant turns in chronological order", () => {
    const context = buildHistoryContext({
      turns: [
        turn("m1", "user", "Compare our next opponents."),
        turn("m2", "assistant", "Which team should I inspect?"),
        turn("m3", "user", "Start with 254."),
      ],
      message: "What about their auto?",
    });
    expect(context.message).toBe("What about their auto?");
    expect(context.history.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
    expect(context.history.map((item) => item.role)).toEqual(["user", "assistant", "user"]);
    expect(context.history.at(-1)?.content).toBe("Start with 254.");
    expect(context.estimatedTokens).toBeGreaterThan(0);
  });

  it("drops system/tool/blank rows and never invents DEMO replies", () => {
    const context = buildHistoryContext({
      turns: [
        { id: "sys", role: "system", content: "You are a helpful DEMO bot." },
        { id: "tool", role: "tool", content: "scouting.team ok" },
        { id: "blank", role: "assistant", content: "   " },
        turn("m1", "user", "Real question"),
        { role: "assistant", content: "Real answer" },
      ],
      message: "Follow up",
    });
    expect(context.history.map((item) => item.content)).toEqual(["Real question", "Real answer"]);
    expect(context.history.every((item) => !/DEMO/i.test(item.content))).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(/DEMO reply/i);
  });

  it("does not duplicate the new user message when it is already the last stored turn", () => {
    const context = buildHistoryContext({
      turns: [
        turn("m1", "user", "First"),
        turn("m2", "assistant", "Noted."),
        turn("m3", "user", "What is the climb time?"),
      ],
      message: "What is the climb time?",
    });
    expect(context.history.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(context.message).toBe("What is the climb time?");
  });

  it("keeps the newest turns inside the count and token budgets", () => {
    const turns = Array.from({ length: CHAT_HISTORY_MAX_TURNS + 8 }, (_, index) =>
      turn(`m-${index}`, index % 2 === 0 ? "user" : "assistant", `${index}:${"x".repeat(80)}`),
    );
    const bounded = buildHistoryContext({
      turns,
      message: "Newest question",
      tokenBudget: 220,
      maxTurns: 6,
    });
    expect(bounded.history).toHaveLength(6);
    expect(bounded.history.map((item) => item.id)).toEqual([
      "m-22",
      "m-23",
      "m-24",
      "m-25",
      "m-26",
      "m-27",
    ]);
    expect(bounded.estimatedTokens).toBeLessThanOrEqual(220);
    expect(bounded.estimatedTokens).toBeLessThanOrEqual(CHAT_HISTORY_TOKEN_BUDGET);
    expect(bounded.droppedDigest).toMatch(/^user: 0:/);
    expect(bounded.droppedDigest).not.toContain("27:");
  });

  it("yields empty history when even the newest prior turn exceeds the budget", () => {
    const context = buildHistoryContext({
      turns: [turn("huge", "assistant", "y".repeat(400))],
      message: "Short follow-up",
      tokenBudget: 20,
    });
    expect(context.history).toEqual([]);
    expect(context.message).toBe("Short follow-up");
    expect(context.estimatedTokens).toBe(0);
    expect(context.droppedDigest).toContain("assistant: ");
    expect(context.droppedDigest).toContain("y".repeat(20));
  });
});
