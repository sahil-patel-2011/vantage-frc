import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import { LEARN_PAGE_DESCRIPTION, LEARN_RESOURCE_CARDS } from "./resources";

describe("learn resource cards", () => {
  it("covers code setup, Onshape, drawings, and the team lab", () => {
    const ids = LEARN_RESOURCE_CARDS.map((card) => card.id);
    expect(ids).toEqual(["dev-setup", "cad-learn", "drawings", "team-6925"]);
    expect(LEARN_RESOURCE_CARDS.find((card) => card.id === "drawings")?.href).toBe("/cad-learn#drawings");
  });

  it("uses student-readable copy and real product paths", () => {
    expectPlainCopy(LEARN_PAGE_DESCRIPTION);
    for (const card of LEARN_RESOURCE_CARDS) {
      expectPlainCopy(card.description);
      expect(card.href.startsWith("/")).toBe(true);
      expect(card.primary.trim().length).toBeGreaterThan(8);
    }
  });
});
