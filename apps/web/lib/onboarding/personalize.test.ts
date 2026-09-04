import { describe, expect, it } from "vitest";
import { ISLAND_TAB_CATALOG } from "../nav/product-nav";
import { isValidIslandSelection } from "../nav/island-preferences";
import {
  clampGreetingHint,
  clampPersonalizedIsland,
  personalizeFromRoles,
} from "./personalize";

const catalog = new Set(ISLAND_TAB_CATALOG.map((item) => item.href));

describe("personalizeFromRoles", () => {
  it("puts a scout on Scout + Team, never a made-up href", () => {
    const view = personalizeFromRoles({
      teamRole: "student",
      crewRole: "scout",
      primaryFocus: "competition",
    });
    expect(isValidIslandSelection(view.islandHrefs)).toBe(true);
    expect(view.islandHrefs[0]).toBe("/dashboard");
    expect(view.islandHrefs).toContain("/competition?tab=scouting");
    expect(view.islandHrefs).toContain("/team");
    expect(view.islandHrefs.every((href) => catalog.has(href))).toBe(true);
    expect(view.greetingHint).toMatch(/scout/i);
    expect(view.greetingHint).not.toMatch(/\d{3,}/);
  });

  it("puts CAD + programming on Build", () => {
    const view = personalizeFromRoles({
      teamRole: "student",
      crewRole: "cad,programming",
      primaryFocus: "build",
    });
    expect(view.islandHrefs).toContain("/build");
    expect(view.greetingHint).toMatch(/CAD/i);
    expect(view.greetingHint).toMatch(/programming/i);
  });

  it("puts a parent with no crew on Logistics", () => {
    const view = personalizeFromRoles({
      teamRole: "parent",
      crewRole: null,
      primaryFocus: "leadership",
    });
    expect(view.islandHrefs).toContain("/logistics");
    expect(view.islandHrefs).toContain("/team");
  });

  it("accepts many identities on one profile", () => {
    const view = personalizeFromRoles({
      teamRole: ["student", "parent"],
      crewRole: ["scout", "business"],
      primaryFocus: "competition",
    });
    expect(view.islandHrefs).toContain("/competition?tab=scouting");
    expect(view.islandHrefs).toContain("/business");
    expect(view.greetingHint).toMatch(/student/i);
  });
});

describe("clampPersonalizedIsland", () => {
  it("drops off-catalog model output", () => {
    const fallback = personalizeFromRoles({ teamRole: "student", crewRole: "cad" });
    const clamped = clampPersonalizedIsland(
      ["/dashboard", "/not-a-real-app", "/team", "/ai"],
      fallback,
    );
    expect(clamped.islandHrefs).toEqual(fallback.islandHrefs);
  });

  it("keeps a valid four from the catalog", () => {
    const fallback = personalizeFromRoles({ teamRole: "student", crewRole: "cad" });
    const proposed = ["/dashboard", "/build", "/team", "/ai"];
    expect(clampPersonalizedIsland(proposed, fallback).islandHrefs).toEqual(proposed);
  });

  it("rejects greeting copy that looks like invented stats", () => {
    expect(clampGreetingHint("You scouted 254 matches last week", "ok")).toBe("ok");
    expect(clampGreetingHint("Scout + CAD on your island.", "ok")).toBe("Scout + CAD on your island.");
  });
});
