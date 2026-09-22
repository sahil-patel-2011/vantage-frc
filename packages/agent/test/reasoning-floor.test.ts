import { describe, expect, it } from "vitest";
import {
  checkReasoningFloor,
  preferForReasoning,
  reasoningNeedFor,
} from "../src/reasoning-floor";

const SONNET = { provider: "anthropic", modelId: "claude-sonnet-5" };
const HAIKU = { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" };
const LOCAL = { provider: "local", modelId: "llama3.1-8b", baseUrlOrigin: "http://127.0.0.1:11434" };
const CUSTOM = { provider: "openrouter", modelId: "some-new-model-v2" };

describe("reasoningNeedFor", () => {
  it("puts judgement work in the reasoning class", () => {
    for (const feature of ["picklist_justifier", "match_strategy", "cad", "decision_critic", "bugbot"]) {
      expect(reasoningNeedFor(feature)).toBe("reasoning");
    }
  });

  it("leaves summarising work as standard", () => {
    for (const feature of ["chat", "briefing", "grant_report_generate", "impact_essay"]) {
      expect(reasoningNeedFor(feature)).toBe("standard");
    }
  });

  it("treats naming and tagging as light", () => {
    expect(reasoningNeedFor("team_tags")).toBe("light");
    expect(reasoningNeedFor("title_suggest")).toBe("light");
  });

  it("defaults an unknown feature to standard rather than to the cheapest class", () => {
    // A feature added next week must not silently get the lowest bar.
    expect(reasoningNeedFor("some_feature_added_later")).toBe("standard");
    expect(reasoningNeedFor(null)).toBe("standard");
  });
});

describe("checkReasoningFloor", () => {
  it("passes a Sonnet-class model for judgement work", () => {
    const result = checkReasoningFloor({ feature: "picklist_justifier", model: SONNET });
    expect(result.meetsFloor).toBe(true);
    expect(result.notice).toBeNull();
  });

  it("flags Haiku for judgement work — fast, but not what should rank an alliance", () => {
    const result = checkReasoningFloor({ feature: "picklist_justifier", model: HAIKU });
    expect(result.need).toBe("reasoning");
    expect(result.tier).toBe("capable");
    expect(result.meetsFloor).toBe(false);
    expect(result.notice).toContain("Sonnet");
  });

  it("accepts Haiku for summarising, because the facts are in front of it", () => {
    const result = checkReasoningFloor({ feature: "chat", model: HAIKU });
    expect(result.meetsFloor).toBe(true);
    expect(result.notice).toBeNull();
  });

  it("still runs on a laptop model, and says what to check", () => {
    const result = checkReasoningFloor({ feature: "match_strategy", model: LOCAL });
    expect(result.meetsFloor).toBe(false);
    // The point is not to refuse — it is to tell the reader what to do.
    expect(result.notice).toContain("starting point");
    expect(result.notice).toContain("check it");
  });

  it("does not call a custom model degraded, but does say to check it", () => {
    const result = checkReasoningFloor({ feature: "cad", model: CUSTOM });
    expect(result.tier).toBe("unknown");
    expect(result.notice).toContain("custom model");
    expect(result.notice).not.toMatch(/worse|bad|poor/i);
  });

  it("says nothing at all when a small model does light work", () => {
    const result = checkReasoningFloor({ feature: "team_tags", model: LOCAL });
    expect(result.meetsFloor).toBe(true);
    expect(result.notice).toBeNull();
  });

  it("never refuses — every combination still yields a usable result", () => {
    for (const feature of ["picklist_justifier", "chat", "team_tags"]) {
      for (const model of [SONNET, HAIKU, LOCAL, CUSTOM]) {
        const result = checkReasoningFloor({ feature, model });
        expect(typeof result.meetsFloor).toBe("boolean");
      }
    }
  });
});

describe("preferForReasoning", () => {
  it("reaches for the strongest model first on judgement work", () => {
    const ordered = preferForReasoning([LOCAL, HAIKU, SONNET], "picklist_justifier");
    expect(ordered[0]).toBe(SONNET);
    expect(ordered[ordered.length - 1]).toBe(LOCAL);
  });

  it("keeps every candidate, because running beats refusing", () => {
    const ordered = preferForReasoning([LOCAL, HAIKU, SONNET], "match_strategy");
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered)).toEqual(new Set([LOCAL, HAIKU, SONNET]));
  });

  it("leaves a team's own order alone for non-reasoning work", () => {
    const ordered = preferForReasoning([LOCAL, HAIKU, SONNET], "chat");
    expect(ordered).toEqual([LOCAL, HAIKU, SONNET]);
  });

  it("is stable within a tier, so a pinned order survives", () => {
    const a = { provider: "anthropic", modelId: "claude-sonnet-5" };
    const b = { provider: "openai", modelId: "gpt-4.1" };
    expect(preferForReasoning([a, b], "cad")).toEqual([a, b]);
    expect(preferForReasoning([b, a], "cad")).toEqual([b, a]);
  });
});
