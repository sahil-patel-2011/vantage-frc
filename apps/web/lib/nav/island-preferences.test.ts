import { describe, expect, it } from "vitest";
import {
  ISLAND_SLOT_COUNT,
  defaultIslandHrefs,
  defaultIslandSentence,
  isDefaultIslandSelection,
  isValidIslandSelection,
  resolveIslandTabs,
  toggleIslandDraft,
} from "./island-preferences";
import { ISLAND_TAB_CATALOG } from "./product-nav";

describe("island preferences", () => {
  it("keeps the four workspace defaults", () => {
    expect(defaultIslandHrefs()).toEqual(["/competition?tab=scouting", "/competition", "/build", "/team"]);
    expect(resolveIslandTabs(null).map((item) => item.label)).toEqual(["Scout", "Compete", "Build", "Run season"]);
    expect(defaultIslandSentence()).toBe("Scout, Compete, Build, and Run season");
  });

  /*
   * With only the four defaults allowlisted, "customize" could do nothing but
   * reorder — while the editor, Appearance, and the manual all offered a swap.
   */
  it("offers destinations beyond the stock four so a slot can actually be traded", () => {
    const catalog = ISLAND_TAB_CATALOG.map((item) => item.href);
    expect(catalog.length).toBeGreaterThan(ISLAND_SLOT_COUNT);
    for (const href of defaultIslandHrefs()) expect(catalog).toContain(href);

    const swapped = ["/competition?tab=scouting", "/competition", "/competition?tab=forms", "/team"];
    expect(isValidIslandSelection(swapped)).toBe(true);
    expect(resolveIslandTabs(swapped).map((item) => item.label)).toEqual([
      "Scout",
      "Compete",
      "Forms",
      "Run season",
    ]);
  });

  it("preserves a valid workspace order", () => {
    const selection = ["/build", "/competition", "/team", "/competition?tab=scouting"];
    expect(isValidIslandSelection(selection)).toBe(true);
    expect(resolveIslandTabs(selection).map((item) => item.label)).toEqual(["Build", "Compete", "Run season", "Scout"]);
  });

  it("rejects duplicates, unknown routes, and the wrong slot count", () => {
    expect(isValidIslandSelection(["/build", "/build", "/team", "/competition"])).toBe(false);
    expect(isValidIslandSelection(["/build", "/competition", "/team"])).toBe(false);
    expect(isValidIslandSelection(["/build", "/competition", "/team", "/unknown"])).toBe(false);
  });

  it("round-trips a saved selection through validate → resolve → hrefs", () => {
    const saved = ["/build", "/competition", "/team", "/competition?tab=scouting"];
    expect(isValidIslandSelection(saved)).toBe(true);
    const restored = resolveIslandTabs(saved).map((item) => item.href);
    expect(restored).toEqual(saved);
    // A round-trip through JSON (how the column actually stores it) is lossless.
    expect(resolveIslandTabs(JSON.parse(JSON.stringify(saved))).map((item) => item.href)).toEqual(saved);
  });

  it("treats defaults and unusable rows as not-customized", () => {
    expect(isDefaultIslandSelection(defaultIslandHrefs())).toBe(true);
    expect(isDefaultIslandSelection(null)).toBe(true);
    expect(isDefaultIslandSelection([])).toBe(true);
    expect(isDefaultIslandSelection(["/build", "/competition", "/team", "/competition?tab=scouting"])).toBe(false);
    // Same four apps in a different order is still a customization.
    const reordered = [...defaultIslandHrefs()].reverse();
    expect(isDefaultIslandSelection(reordered)).toBe(false);
  });

  it("toggles a draft in tap order and refuses a fifth slot", () => {
    let draft: string[] = [];
    for (const href of ["/build", "/competition", "/team", "/competition?tab=scouting"]) {
      const result = toggleIslandDraft(draft, href);
      expect(result.error).toBeNull();
      draft = result.draft;
    }
    expect(draft).toHaveLength(ISLAND_SLOT_COUNT);

    const overflow = toggleIslandDraft(draft, "/another-workspace");
    expect(overflow.error).toContain("4 apps");
    expect(overflow.draft).toEqual(draft);

    const removed = toggleIslandDraft(draft, "/competition");
    expect(removed.draft).toEqual(["/build", "/team", "/competition?tab=scouting"]);
    expect(toggleIslandDraft(removed.draft, "/not-a-route").error).toBeTruthy();
  });
});
