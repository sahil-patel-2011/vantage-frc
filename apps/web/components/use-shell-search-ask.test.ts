import { describe, expect, it } from "vitest";
import { isAskAiHref, looksLikeQuestion } from "./use-shell-search";

describe("search or ask", () => {
  it("knows the assistant's own address, so it is not also a result", () => {
    expect(isAskAiHref("/ai")).toBe(true);
    expect(isAskAiHref("/ai?tab=chat")).toBe(true);
    expect(isAskAiHref("/chat")).toBe(true);
    expect(isAskAiHref("/ai?tab=budgets")).toBe(false);
    expect(isAskAiHref("/team?tab=messages")).toBe(false);
  });

  it("sends a question to Ask AI on Enter, and a name to its page", () => {
    expect(looksLikeQuestion("who should we pick")).toBe(true);
    expect(looksLikeQuestion("best auton for 254?")).toBe(true);
    expect(looksLikeQuestion("How do I reset the gyro")).toBe(true);
    expect(looksLikeQuestion("pick list")).toBe(false);
    expect(looksLikeQuestion("scout")).toBe(false);
    expect(looksLikeQuestion("is")).toBe(false);
  });
});
