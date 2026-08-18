import { describe, expect, it } from "vitest";
import { defaultIslandHrefs, isValidIslandSelection, resolveIslandTabs } from "./island-preferences";

describe("island preferences", () => {
  it("keeps the four existing defaults", () => {
    expect(defaultIslandHrefs()).toEqual(["/dashboard", "/competition", "/team", "/business"]);
    expect(resolveIslandTabs(null).map((item) => item.label)).toEqual(["Home", "Compete", "Team", "Business"]);
  });

  it("preserves a valid custom order", () => {
    const selection = ["/competition?tab=scouting", "/build", "/team?tab=messages", "/ai"];
    expect(isValidIslandSelection(selection)).toBe(true);
    expect(resolveIslandTabs(selection).map((item) => item.label)).toEqual(["Scout", "Build", "Team chat", "AI"]);
  });

  it("rejects duplicates, unknown routes, and the wrong slot count", () => {
    expect(isValidIslandSelection(["/dashboard", "/dashboard", "/team", "/business"])).toBe(false);
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team"])).toBe(false);
    expect(isValidIslandSelection(["/dashboard", "/competition", "/team", "/unknown"])).toBe(false);
  });
});
