import { describe, expect, it } from "vitest";
import { classifyMeteredAiError } from "../src/usage-cutoff";
import {
  estimatedFreeTokens,
  FreeTokensExhaustedError,
  isFreeTokenSource,
  isMissingFreeTokenSchema,
} from "../src/free-tokens";

describe("free token gifts", () => {
  it("accepts only the sources an admin can gift", () => {
    expect(isFreeTokenSource("freebuff")).toBe(true);
    expect(isFreeTokenSource("hosted_platform")).toBe(true);
    expect(isFreeTokenSource("credits")).toBe(true);
    expect(isFreeTokenSource("openai")).toBe(false);
  });

  it("estimates a positive token hold without inventing zero", () => {
    expect(estimatedFreeTokens({})).toBe(1200);
    expect(estimatedFreeTokens({ estimatedPromptTokens: 10, estimatedCompletionTokens: 5 })).toBe(15);
  });

  it("names an exhausted gift as free tokens, not credits", () => {
    const error = new FreeTokensExhaustedError(400, 12);
    expect(error.code).toBe("free_tokens_exhausted");
    expect(error.message).toMatch(/free tokens/);
    expect(error.message).not.toMatch(/credit/i);
    const classified = classifyMeteredAiError(error);
    expect(classified).toMatchObject({
      status: 402,
      reason: "free_tokens_exhausted",
    });
    expect(classified?.message).toMatch(/free tokens/);
    expect(classified?.message).not.toMatch(/credit/i);
    expect(classified?.cta.href).toBe("/team/ai-keys");
  });

  it("treats a missing gift table as not configured, not a hard AI failure", () => {
    expect(isMissingFreeTokenSchema(new Error('relation "ai_free_token_ledger" does not exist'))).toBe(true);
    expect(isMissingFreeTokenSchema(new Error("org_ai_free_tokens"))).toBe(true);
    expect(isMissingFreeTokenSchema(new Error("connection refused"))).toBe(false);
  });
});
