import { describe, expect, it } from "vitest";
import { aiMemoryShellCopy } from "../ai-memory/ai-memory-related";

describe("leftover AI Memory setup chrome", () => {
  it("sharing on with no rows is Nothing shared, not Setup", () => {
    expect(aiMemoryShellCopy("setup").badge).toBe("Nothing shared");
    expect(aiMemoryShellCopy("setup").title).toMatch(/nothing shared/i);
    expect(aiMemoryShellCopy("empty").badge).toBe("Empty");
  });
});
