import { describe, expect, it } from "vitest";
import { formatModelList, matchModelList, modelTokens, normalizeModelText } from "./model-list";

const OPTIONS = [
  { id: "anthropic:claude-haiku-5-5", modelId: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  {
    id: "anthropic:claude-haiku-5-5@low",
    modelId: "claude-haiku-5-5",
    label: "Claude Haiku 5.5 · Low effort",
    fixedOnly: true,
  },
  { id: "openai:gpt-4.1-mini", modelId: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

describe("model list", () => {
  it("splits on commas and ignores empty slots and case", () => {
    expect(modelTokens(" gpt-4.1-mini, , Claude Haiku 5.5 ")).toEqual(["gpt-4.1-mini", "Claude Haiku 5.5"]);
    expect(normalizeModelText("gpt-4.1-mini,Claude Haiku 5.5")).toBe("gpt-4.1-mini, Claude Haiku 5.5");
  });

  it("matches a model id, a catalog id, or a label, and drops duplicates", () => {
    const matched = matchModelList("GPT-4.1 mini, openai:gpt-4.1-mini, claude-haiku-5-5", OPTIONS, "automode");
    expect(matched.unknown).toEqual([]);
    expect(matched.ids).toEqual(["openai:gpt-4.1-mini", "anthropic:claude-haiku-5-5"]);
  });

  it("names a model it does not know, and keeps a fixed-only variant out of automode", () => {
    const matched = matchModelList("not-a-model, Claude Haiku 5.5 · Low effort", OPTIONS, "automode");
    expect(matched.ids).toEqual([]);
    expect(matched.unknown).toEqual([
      "not-a-model",
      "Claude Haiku 5.5 · Low effort (only available when you choose one model)",
    ]);
  });

  it("uses the first recognized model when one model is selected", () => {
    const matched = matchModelList("claude-haiku-5-5, gpt-4.1-mini", OPTIONS, "fixed");
    expect(matched.ids).toEqual(["anthropic:claude-haiku-5-5"]);
    expect(formatModelList(matched.ids, OPTIONS)).toBe("claude-haiku-5-5");
  });
});
