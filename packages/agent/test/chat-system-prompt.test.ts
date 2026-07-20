import { describe, expect, it } from "vitest";
import { buildVantageChatSystemPrompt } from "../src/chat-system-prompt";

describe("buildVantageChatSystemPrompt", () => {
  it("includes FRC role, honesty, and Soft-UI style rules", () => {
    const prompt = buildVantageChatSystemPrompt({ capability: "chat" });
    expect(prompt).toMatch(/FRC/i);
    expect(prompt).toMatch(/Soft-UI/);
    expect(prompt).toMatch(/DEMO/i);
    expect(prompt).toMatch(/fabricat/i);
    expect(prompt).toMatch(/youth-safe/i);
    expect(prompt).toContain("Current surface: chat");
  });

  it("accepts extra sanitized lines", () => {
    const prompt = buildVantageChatSystemPrompt({
      capability: "strategy",
      extraLines: ["Prefer match strategy over general advice."],
    });
    expect(prompt).toContain("Current surface: strategy");
    expect(prompt).toContain("Prefer match strategy over general advice.");
  });
});
