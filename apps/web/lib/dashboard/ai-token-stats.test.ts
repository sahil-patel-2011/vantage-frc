import { describe, expect, it } from "vitest";
import {
  fillTokenSpark,
  formatTokenCount,
  pickMostUsedModel,
  rankTeamsByTokens,
  safeTokenCount,
  shortModelLabel,
} from "./ai-token-stats";

describe("ai token stats", () => {
  it("never invents a token count from garbage input", () => {
    expect(safeTokenCount(undefined)).toBe(0);
    expect(safeTokenCount(-4)).toBe(0);
    expect(safeTokenCount("12.9")).toBe(12);
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(1500)).toBe("1.5k");
  });

  it("picks the model that actually used the most tokens", () => {
    expect(pickMostUsedModel([])).toBeNull();
    expect(
      pickMostUsedModel([
        { model: "glm/glm-5.3-flash", tokens: 800, calls: 2 },
        { model: "mimo/mimo-2.5", tokens: 1200, calls: 1 },
      ]),
    ).toEqual({ model: "mimo/mimo-2.5", tokens: 1200, calls: 1 });
  });

  it("fills missing spark days with real zeros", () => {
    expect(fillTokenSpark([{ day: "2026-09-01", tokens: 40, calls: 2 }], "2026-09-02", 3)).toEqual([
      { day: "2026-08-31", tokens: 0, calls: 0 },
      { day: "2026-09-01", tokens: 40, calls: 2 },
      { day: "2026-09-02", tokens: 0, calls: 0 },
    ]);
  });

  it("ranks teams by tokens and does not invent a leader", () => {
    expect(
      rankTeamsByTokens([
        { orgId: "b", name: "B", teamNumber: 2, tokens: 10, calls: 1, mostUsed: "glm", lastUsedAt: null },
        { orgId: "a", name: "A", teamNumber: 1, tokens: 40, calls: 3, mostUsed: "mimo", lastUsedAt: null },
      ]).map((row) => row.orgId),
    ).toEqual(["a", "b"]);
  });

  it("shortens a slug without inventing a display name", () => {
    expect(shortModelLabel(null)).toBe("—");
    expect(shortModelLabel("glm/glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(shortModelLabel("mimo-2.5")).toBe("mimo-2.5");
  });
});
