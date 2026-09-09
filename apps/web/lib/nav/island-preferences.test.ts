import { describe, expect, it } from "vitest";
import {
  ISLAND_SLOT_COUNT,
  defaultIslandHrefs,
  isDefaultIslandSelection,
  isValidIslandSelection,
  resolveIslandTabs,
  toggleIslandDraft,
} from "./island-preferences";

describe("island preferences", () => {
  it("defaults to Home, Compete, Team, Build — the student's week, not the mentor's", () => {
    expect(defaultIslandHrefs()).toEqual(["/dashboard", "/competition", "/team", "/build"]);
    expect(resolveIslandTabs(null).map((item) => item.label)).toEqual(["Home", "Compete", "Team", "Build"]);
  });

  it("preserves a valid custom order", () => {
    const selection = ["/competition?tab=scouting", "/business", "/team?tab=messages", "/ai?tab=chat"];
    expect(isValidIslandSelection(selection)).toBe(true);
    expect(resolveIslandTabs(selection).map((item) => item.label)).toEqual(["Scout", "Business", "Team chat", "Ask AI"]);
  });

  it("rejects duplicates, unknown routes, the retired /ai and /media roots, and the wrong slot count", () => {
    expect(isValidIslandSelection(["/dashboard", "/dashboard", "/team", "/business"])).toBe(false);
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team"])).toBe(false);
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team", "/unknown"])).toBe(false);
    // A saved row from before AI and Media left the top level is treated as
    // not-customized rather than crashing the island; the user sees the defaults.
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team", "/ai"])).toBe(false);
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team", "/media"])).toBe(false);
  });

  it("round-trips a saved selection through validate → resolve → hrefs", () => {
    const saved = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"];
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
    expect(isDefaultIslandSelection(["/build", "/ai?tab=chat", "/team?tab=messages", "/business"])).toBe(false);
    // Same four apps in a different order is still a customization.
    const reordered = [...defaultIslandHrefs()].reverse();
    expect(isDefaultIslandSelection(reordered)).toBe(false);
  });

  it("toggles a draft in tap order and refuses a fifth slot", () => {
    let draft: string[] = [];
    for (const href of ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"]) {
      const result = toggleIslandDraft(draft, href);
      expect(result.error).toBeNull();
      draft = result.draft;
    }
    expect(draft).toHaveLength(ISLAND_SLOT_COUNT);

    const overflow = toggleIslandDraft(draft, "/dashboard");
    expect(overflow.error).toContain("4 apps");
    expect(overflow.draft).toEqual(draft);

    const removed = toggleIslandDraft(draft, "/ai?tab=chat");
    expect(removed.draft).toEqual(["/build", "/team?tab=messages", "/business"]);
    expect(toggleIslandDraft(removed.draft, "/not-a-route").error).toBeTruthy();
  });
});
