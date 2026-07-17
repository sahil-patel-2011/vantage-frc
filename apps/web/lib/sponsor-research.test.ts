import { describe, expect, it } from "vitest";
import { suggestProspectCategories } from "./sponsor-research";

describe("sponsor prospect category suggestions", () => {
  it("returns the requested number of categories with a rationale", () => {
    const suggestions = suggestProspectCategories([], 5);
    expect(suggestions).toHaveLength(5);
    for (const suggestion of suggestions) {
      expect(suggestion.rationale.length).toBeGreaterThan(0);
    }
  });

  it("de-prioritizes categories that overlap with existing sponsor industries", () => {
    const suggestions = suggestProspectCategories(
      [{ industry: "manufacturing", tier: "gold", stateProv: "OH" }],
      3,
    );
    expect(suggestions.some((s) => s.category.toLowerCase().includes("manufacturing"))).toBe(false);
  });

  it("falls back to the full playbook once novel categories run out", () => {
    expect(suggestProspectCategories([], 10)).toHaveLength(10);
  });
});
