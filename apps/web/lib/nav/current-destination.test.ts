import { describe, expect, it } from "vitest";
import { isCurrentDestination } from "./current-destination";

describe("isCurrentDestination", () => {
  it("matches the same hub tab whatever else the address carries", () => {
    const here = { pathname: "/competition", search: "?tab=command&orgId=abc" };
    expect(isCurrentDestination("/competition?tab=command", here)).toBe(true);
    expect(isCurrentDestination("/competition?tab=scouting", here)).toBe(false);
    expect(isCurrentDestination("/team?tab=command", here)).toBe(false);
  });

  it("reads a hub root with no tab as its default tab", () => {
    expect(isCurrentDestination("/competition?tab=scouting", { pathname: "/competition", search: "" })).toBe(true);
    expect(isCurrentDestination("/competition", { pathname: "/competition", search: "?tab=scouting" })).toBe(true);
  });

  it("matches plain pages by path", () => {
    expect(isCurrentDestination("/settings", { pathname: "/settings", search: "?orgId=x" })).toBe(true);
    expect(isCurrentDestination("/help", { pathname: "/settings", search: "" })).toBe(false);
  });
});
