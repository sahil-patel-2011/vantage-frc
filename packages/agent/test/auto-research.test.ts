import { describe, expect, it } from "vitest";
import { classifyTaskDifficulty, consultingAllowed } from "../src/auto-mode";
import { pickByokModelForFeature } from "../src/byok-model-routing";
import {
  compactContextItems,
  contextTokenBudgetForAdapter,
  LOCAL_CONTEXT_TOKEN_BUDGET,
} from "../src/context-compact";
import { buildDesignResearchQueries, extractMechanismTopic } from "../src/design-research";
import { chatCompletionMaxTokens } from "../src/http-chat-adapter";
import {
  evaluateRunCompletion,
  formatCompletionReport,
  shouldRefuseEarlyFinal,
} from "../src/task-finish";

const ANTHROPIC_POOL = [
  "anthropic:claude-opus-4-20250514",
  "anthropic:claude-sonnet-4-20250514",
  "anthropic:claude-haiku-4-5",
];

describe("auto-compact context", () => {
  it("keeps local Ollama/LM Studio on a tight budget and folds overflow", () => {
    expect(
      contextTokenBudgetForAdapter({ provider: "openai-compatible", model: "llama3.1:8b" }),
    ).toBe(LOCAL_CONTEXT_TOKEN_BUDGET);
    const items = Array.from({ length: 40 }, (_, i) => ({
      type: "module_fact" as const,
      id: `fact-${i}`,
      importance: i < 3 ? 900 : 10,
      content: "x".repeat(800),
    }));
    const compacted = compactContextItems(items, 500);
    expect(compacted.compacted).toBe(true);
    expect(compacted.items.some((item) => item.id === "auto-compact")).toBe(true);
    expect(compacted.estimatedTokens).toBeLessThanOrEqual(500);
  });
});

describe("AUTO routing + consulting", () => {
  it("classifies CAD/agent work as hard unless it is a short light task", () => {
    expect(classifyTaskDifficulty("Design a gearbox for the elevator", "cad")).toBe("hard");
    expect(classifyTaskDifficulty("rename the label on this status card", "agent")).toBe("light");
    expect(classifyTaskDifficulty("hello", "chat")).toBe("light");
  });

  it("blocks consulting when the run is locked or Fixed", () => {
    expect(consultingAllowed({ mode: "automode", consultEnabled: true })).toBe(true);
    expect(consultingAllowed({ mode: "automode", consultEnabled: true, lockRun: true })).toBe(false);
    expect(consultingAllowed({ mode: "fixed", consultEnabled: true })).toBe(false);
    expect(consultingAllowed({ mode: "automode", consultEnabled: false })).toBe(false);
  });

  it("uses Fable/Opus for think and Sonnet for execute while consulting", () => {
    const think = pickByokModelForFeature({
      feature: "cad",
      mode: "automode",
      enabledModelIds: ANTHROPIC_POOL,
      availableProviders: ["anthropic"],
      difficulty: "hard",
      role: "think",
      consulting: true,
    });
    expect(think?.id).toBe("anthropic:claude-opus-4-20250514");

    const execute = pickByokModelForFeature({
      feature: "cad",
      mode: "automode",
      enabledModelIds: ANTHROPIC_POOL,
      availableProviders: ["anthropic"],
      difficulty: "hard",
      role: "execute",
      consulting: true,
    });
    expect(execute?.id).toBe("anthropic:claude-sonnet-4-20250514");
  });

  it("locks hard CAD to Opus/Fable when consulting is off", () => {
    const locked = pickByokModelForFeature({
      feature: "cad",
      mode: "automode",
      enabledModelIds: ANTHROPIC_POOL,
      availableProviders: ["anthropic"],
      difficulty: "hard",
      role: "execute",
      consulting: false,
    });
    expect(locked?.id).toBe("anthropic:claude-opus-4-20250514");
  });
});

describe("design research", () => {
  it("builds FRC mechanical queries from the topic", () => {
    expect(extractMechanismTopic("Need an elevator")).toBe("elevator");
    const queries = buildDesignResearchQueries("FRC coral intake", "intake");
    expect(queries.some((q) => /intake/i.test(q))).toBe(true);
    expect(queries.some((q) => /Chief Delphi/i.test(q))).toBe(true);
  });
});

describe("finish / verify report", () => {
  it("refuses an early CAD final that skipped research", () => {
    const report = evaluateRunCompletion({
      goal: "Design a swerve module gearbox",
      answer: "I guess a 3:1 reduction is fine.",
      toolsUsed: [],
      feature: "cad",
    });
    expect(shouldRefuseEarlyFinal(report, "Design a swerve module gearbox", "cad")).toBe(true);
    expect(report.verified).toBe(false);
    expect(formatCompletionReport(report, report.what.join(" "))).toMatch(/What I did/i);
    expect(formatCompletionReport(report, "x")).toMatch(/What's left/i);
  });

  it("accepts a researched mechanical answer with COTS language", () => {
    const report = evaluateRunCompletion({
      goal: "Design a coral intake",
      answer:
        "What I did: researched current FRC intakes. Why: use a Kraken + VP belt reduction and 2in compliant wheels. What's left: none. Checked against COTS belt layouts.",
      toolsUsed: ["design.research"],
      feature: "cad",
    });
    expect(report.simulated.ok).toBe(true);
    expect(shouldRefuseEarlyFinal(report, "Design a coral intake", "cad")).toBe(false);
  });

  it("gives agent/CAD completions a larger token budget", () => {
    expect(chatCompletionMaxTokens("agent")).toBe(4096);
    expect(chatCompletionMaxTokens("chat")).toBe(1024);
  });
});
