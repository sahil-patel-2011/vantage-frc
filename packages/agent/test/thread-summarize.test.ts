import { describe, expect, it } from "vitest";
import { digestThreadTurns, threadSummarizeMessage } from "../src/thread-summarize";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("thread summarize", () => {
  it("keeps the caller's own words in order and does not invent a recap", () => {
    const digest = digestThreadTurns([
      { role: "user", content: "Scout 254" },
      { role: "assistant", content: "They climb in 3s." },
    ]);
    expect(digest).toBe("user: Scout 254\nassistant: They climb in 3s.");
    expect(digest).not.toMatch(/recap|summary|DEMO/i);
  });

  it("scopes the LLM prompt to one org and the turns handed in", () => {
    const prompt = threadSummarizeMessage(ORG, [{ role: "user", content: "Our defense" }]);
    expect(prompt).toContain(ORG);
    expect(prompt).toContain("Our defense");
    expect(prompt).toMatch(/Do not add facts/);
    expect(prompt).not.toMatch(/team 254|another organization/);
  });
});
