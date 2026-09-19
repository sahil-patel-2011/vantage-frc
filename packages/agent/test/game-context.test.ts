import { describe, expect, it } from "vitest";
import { gameContextLines, seasonLabel } from "../src/game-context";
import { buildVantageChatSystemPrompt } from "../src/chat-system-prompt";
import { REBUILT_2026, BIOCORE_2027 } from "@vantage/game-year";

const published = { pack: REBUILT_2026 };
const awaiting = { pack: BIOCORE_2027 };

describe("telling the model which game it is", () => {
  it("names the season and the actions teams record", () => {
    const lines = gameContextLines(published).join(" ");
    expect(lines).toContain("2026 REBUILT");
    expect(lines).toContain("manual is published");
    // The useful part: naming this season's actions is what stops an answer
    // about cargo, cones or notes from a season that is not this one.
    expect(lines).toContain("tower level");
    expect(lines).toContain("teleop fuel");
  });

  it("refuses to describe a season whose manual is not out", () => {
    const lines = gameContextLines(awaiting).join(" ");
    expect(lines).toContain("not published yet");
    expect(lines).toMatch(/Do not describe this season's scoring/);
    // And it does not list actions it cannot know.
    expect(lines).not.toContain("Actions teams record");
  });

  it("always forbids inventing a point value", () => {
    // Vantage carries no point values on purpose — what an action is worth is
    // in the manual and in the team's own formula. The model must not fill
    // that gap, in either season state.
    for (const pack of [published, awaiting]) {
      const lines = gameContextLines(pack).join(" ");
      expect(lines).toContain("value formula");
      expect(lines).toMatch(/Never guess a point value/);
      expect(lines).toMatch(/never carry one over from a previous season/i);
    }
  });

  it("says nothing at all when there is no pack", () => {
    // A sentence about not knowing the season would be noise; the honesty
    // rules already cover not knowing things.
    expect(gameContextLines(null)).toEqual([]);
    expect(gameContextLines(undefined)).toEqual([]);
    expect(gameContextLines({ pack: { year: 0, gameName: "", status: "published", scoringKeys: [] } })).toEqual([]);
  });

  it("labels a season for a surface that wants one line", () => {
    expect(seasonLabel(published)).toBe("2026 REBUILT");
    expect(seasonLabel(awaiting)).toBe("2027 BIOCORE (manual not out)");
    expect(seasonLabel(null)).toBeNull();
  });
});

describe("the system prompt carries it", () => {
  it("includes the season when given one", () => {
    const prompt = buildVantageChatSystemPrompt({ capability: "chat", game: published });
    expect(prompt).toContain("2026 REBUILT");
    expect(prompt).toContain("value formula");
  });

  it("is unchanged when no game is supplied", () => {
    // Additive: every existing caller passes nothing and must get exactly
    // what it got before.
    const before = buildVantageChatSystemPrompt({ capability: "chat" });
    expect(before).not.toContain("REBUILT");
    expect(before).toContain("You are Vantage");
  });

  it("still refuses to invent numbers, which is the older rule", () => {
    const prompt = buildVantageChatSystemPrompt({ capability: "strategy", game: published });
    expect(prompt).toMatch(/Do not fill gaps with made-up scores/);
  });
});

describe("the adapter does not leave it to the caller", () => {
  it("puts the season in the prompt every hosted and BYOK call uses", async () => {
    // The mistake this guards against is the one this repo keeps making: a
    // well-tested module that nothing calls. The prompt builder accepting a
    // game is worth nothing unless the adapter passes one.
    const { HttpChatAdapter } = await import("../src/http-chat-adapter");
    const adapter = new HttpChatAdapter({
      provider: "openai",
      apiKey: "test-key-not-real",
      model: "gpt-x",
      baseUrl: "https://example.invalid/v1",
      prices: { inputPerMillion: 1, outputPerMillion: 1 },
      capability: "chat",
    } as never);
    const prompt = (adapter as unknown as { systemPrompt: string }).systemPrompt;
    expect(prompt).toMatch(/The current FRC season is \d{4} [A-Z]+/);
    expect(prompt).toMatch(/Never guess a point value/);
  });
});
