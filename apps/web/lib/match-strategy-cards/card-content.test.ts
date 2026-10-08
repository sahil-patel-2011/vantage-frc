import { describe, expect, it } from "vitest";
import { EMPTY_CARD_CONTENT, normalizeCardContent, sameCardContent } from "./card-content";

describe("saved match-plan acknowledgement", () => {
  it("compares actual content, allowing API whitespace normalization and blank role removal", () => {
    const draft = { ...EMPTY_CARD_CONTENT, gamePlan: "  Keep the middle lane open  ", roleAssignments: [{ role: " Driver ", assignee: " Ada " }, { role: " ", assignee: "" }] };
    const saved = { ...EMPTY_CARD_CONTENT, gamePlan: "Keep the middle lane open", roleAssignments: [{ role: "Driver", assignee: "Ada" }] };
    expect(sameCardContent(draft, saved)).toBe(true);
    expect(sameCardContent(draft, { ...saved, gamePlan: "Old plan" })).toBe(false);
    expect(sameCardContent(draft, { ...saved, roleAssignments: [{ role: "Driver", assignee: "Grace" }] })).toBe(false);
    expect(normalizeCardContent(draft)).toEqual(saved);
  });
});
