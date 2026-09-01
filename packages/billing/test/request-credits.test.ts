import { describe, expect, it } from "vitest";
import {
  DEFAULT_REQUEST_CREDIT_WEIGHTS,
  RequestCreditsExhaustedError,
  creditsForRequest,
  isRequestKind,
  requestKindForFeature,
  resolveRequestCreditBalance,
} from "../src/request-credits";

describe("request kind classification", () => {
  it("treats agent-shaped features as agentic and on-server compute as free", () => {
    expect(requestKindForFeature("chat")).toBe("chat");
    expect(requestKindForFeature("agent")).toBe("agentic");
    expect(requestKindForFeature("cad")).toBe("agentic");
    expect(requestKindForFeature("coding")).toBe("agentic");
    expect(requestKindForFeature("bugbot_ultra")).toBe("agentic");
    expect(requestKindForFeature("bugbot_anything_new")).toBe("agentic");
    expect(requestKindForFeature("judge_sim")).toBe("deterministic");
    expect(requestKindForFeature("spare_forecast")).toBe("deterministic");
    expect(requestKindForFeature("scout_voice_stt")).toBe("stt");
    // bugbot_scan is a queued relay job, so it bills as background rather than
    // falling through to the generic bugbot* -> agentic rule.
    expect(requestKindForFeature("bugbot_scan")).toBe("background");
  });

  it("falls back to chat for unknown or blank features without throwing", () => {
    expect(requestKindForFeature(undefined)).toBe("chat");
    expect(requestKindForFeature("")).toBe("chat");
    expect(requestKindForFeature("some_future_feature")).toBe("chat");
  });

  it("guards the kind union", () => {
    expect(isRequestKind("agentic")).toBe(true);
    expect(isRequestKind("nonsense")).toBe(false);
    expect(isRequestKind(null)).toBe(false);
  });
});

describe("credits per request", () => {
  it("charges one credit for a plain chat turn and more for an agent run", () => {
    expect(creditsForRequest({ kind: "chat" })).toBe(1);
    expect(creditsForRequest({ kind: "agentic" })).toBe(DEFAULT_REQUEST_CREDIT_WEIGHTS.agentic);
    expect(creditsForRequest({ kind: "agentic" })).toBeGreaterThan(
      creditsForRequest({ kind: "chat" }),
    );
  });

  it("never charges for deterministic or embedding work", () => {
    expect(creditsForRequest({ kind: "deterministic" })).toBe(0);
    expect(creditsForRequest({ kind: "embedding" })).toBe(0);
  });

  it("scales an agentic run by the model turns it actually made", () => {
    const one = creditsForRequest({ kind: "agentic", steps: 1 });
    const three = creditsForRequest({ kind: "agentic", steps: 3 });
    expect(three).toBe(one * 3);
    // Steps never discount below the base weight.
    expect(creditsForRequest({ kind: "agentic", steps: 0 })).toBe(one);
    expect(creditsForRequest({ kind: "chat", steps: 9 })).toBe(1);
  });

  it("honors platform-tuned weights over the defaults", () => {
    expect(creditsForRequest({ kind: "agentic", weights: { agentic: 10 } })).toBe(10);
    expect(creditsForRequest({ kind: "chat", weights: { chat: 0 } })).toBe(0);
  });
});

describe("balance math", () => {
  const future = new Date("2030-01-01T00:00:00.000Z").toISOString();
  const past = new Date("2020-01-01T00:00:00.000Z").toISOString();

  it("sums grants minus spend without a denormalized counter", () => {
    expect(
      resolveRequestCreditBalance([
        { entryKind: "grant", credits: 500 },
        { entryKind: "consumption", credits: -4 },
        { entryKind: "consumption", credits: -1 },
      ]),
    ).toEqual({ granted: 500, spent: 5, balance: 495 });
  });

  it("drops expired grants but keeps the spend they already funded", () => {
    const result = resolveRequestCreditBalance([
      { entryKind: "grant", credits: 100, expiresAt: past },
      { entryKind: "grant", credits: 20, expiresAt: future },
      { entryKind: "consumption", credits: -5 },
    ]);
    expect(result.granted).toBe(20);
    expect(result.spent).toBe(5);
    expect(result.balance).toBe(15);
  });

  it("treats a revoke like spend", () => {
    const result = resolveRequestCreditBalance([
      { entryKind: "grant", credits: 50 },
      { entryKind: "revoke", credits: -50 },
    ]);
    expect(result.balance).toBe(0);
  });

  it("reports an empty ledger as a zero balance, not an error", () => {
    expect(resolveRequestCreditBalance([])).toEqual({ granted: 0, spent: 0, balance: 0 });
  });
});

describe("exhaustion error", () => {
  it("names the shortfall and points at a real next step", () => {
    const error = new RequestCreditsExhaustedError(4, 1);
    expect(error.code).toBe("request_credits_exhausted");
    expect(error.message).toContain("needed 4");
    expect(error.message).toContain("1 left");
    expect(error.message).toMatch(/AI API keys/);
    expect(error.message).not.toMatch(/demo/i);
  });
});
