import { describe, expect, it } from "vitest";
import { REQUIRED_SYSTEM_PROMPT_RULES, buildVantageChatSystemPrompt } from "../src/chat-system-prompt";

describe("buildVantageChatSystemPrompt", () => {
  it("pins the honesty, verify, and youth-safe rules in student-facing words", () => {
    const prompt = buildVantageChatSystemPrompt({ capability: "chat" });
    expect(prompt).toMatch(/FRC/i);
    expect(prompt).toContain("Current surface: chat");
    for (const rule of REQUIRED_SYSTEM_PROMPT_RULES) {
      expect(prompt, rule).toContain(rule);
    }
    expect(prompt).not.toMatch(/Soft-UI/);
    expect(prompt).not.toMatch(/\bDEMO\b/);
  });

  it("accepts extra sanitized lines and names the answer path", () => {
    const prompt = buildVantageChatSystemPrompt({
      capability: "strategy",
      extraLines: ["Prefer match strategy over general advice."],
      answerPath: "relay",
      activeEvent: "2026mndu",
      teamFacts: ["Team 6925, The Fighting Pandas."],
    });
    expect(prompt).toContain("Current surface: strategy");
    expect(prompt).toContain("Prefer match strategy over general advice.");
    expect(prompt).toContain("paired relay");
    expect(prompt).toContain("2026mndu");
    expect(prompt).toContain("6925");
  });
});
