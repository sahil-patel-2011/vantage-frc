import { describe, expect, it } from "vitest";
import {
  ChatUpstreamTimeoutError,
  DEFAULT_CHAT_FETCH_TIMEOUT_MS,
  isChatUpstreamTimeout,
  MAX_CHAT_FETCH_TIMEOUT_MS,
  MIN_CHAT_FETCH_TIMEOUT_MS,
  resolveChatFetchTimeoutMs,
} from "../src/chat-timeout";

describe("resolveChatFetchTimeoutMs", () => {
  it("defaults to 50s so the adapter aborts before a 60s serverless function is killed", () => {
    expect(DEFAULT_CHAT_FETCH_TIMEOUT_MS).toBe(50_000);
    expect(DEFAULT_CHAT_FETCH_TIMEOUT_MS).toBeLessThan(60_000);
    expect(resolveChatFetchTimeoutMs()).toBe(50_000);
    expect(resolveChatFetchTimeoutMs(null)).toBe(50_000);
    expect(resolveChatFetchTimeoutMs("")).toBe(50_000);
  });

  it("accepts explicit numeric and string overrides", () => {
    expect(resolveChatFetchTimeoutMs(20_000)).toBe(20_000);
    expect(resolveChatFetchTimeoutMs("30000")).toBe(30_000);
    expect(resolveChatFetchTimeoutMs(" 45000 ")).toBe(45_000);
  });

  it("falls back to the default on garbage, zero, and negative values", () => {
    expect(resolveChatFetchTimeoutMs("not-a-number")).toBe(DEFAULT_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs("NaN")).toBe(DEFAULT_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs(0)).toBe(DEFAULT_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs(-5_000)).toBe(DEFAULT_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_CHAT_FETCH_TIMEOUT_MS);
  });

  it("clamps into the [1s, 290s] band so a typo cannot abort instantly or outlive the function", () => {
    expect(resolveChatFetchTimeoutMs(1)).toBe(MIN_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs("999")).toBe(MIN_CHAT_FETCH_TIMEOUT_MS);
    expect(resolveChatFetchTimeoutMs(10_000_000)).toBe(MAX_CHAT_FETCH_TIMEOUT_MS);
    expect(MAX_CHAT_FETCH_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it("rounds fractional values", () => {
    expect(resolveChatFetchTimeoutMs(1500.6)).toBe(1501);
  });
});

describe("ChatUpstreamTimeoutError", () => {
  it("is a named 504 with the timeout budget in the message", () => {
    const error = new ChatUpstreamTimeoutError(50_000);
    expect(error.name).toBe("ChatUpstreamTimeoutError");
    expect(error.status).toBe(504);
    expect(error.timeoutMs).toBe(50_000);
    expect(error.message).toContain("50000ms");
  });

  it("is recognized by instance and by duck-typed name", () => {
    expect(isChatUpstreamTimeout(new ChatUpstreamTimeoutError(1_000))).toBe(true);
    const foreign = new Error("Upstream chat request timed out after 1000ms");
    foreign.name = "ChatUpstreamTimeoutError";
    expect(isChatUpstreamTimeout(foreign)).toBe(true);
    expect(isChatUpstreamTimeout(new Error("AbortError"))).toBe(false);
    expect(isChatUpstreamTimeout(null)).toBe(false);
  });
});
