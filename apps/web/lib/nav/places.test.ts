import { describe, expect, it } from "vitest";
import { IDLE_PREFETCH_HREFS, PLACES, placeForPath, visiblePlaces } from "./places";

describe("the five places", () => {
  it("are Home, Competition, Team, Build and Business, in that order", () => {
    expect(PLACES.map((place) => place.label)).toEqual(["Home", "Competition", "Team", "Build", "Business"]);
    expect(PLACES.map((place) => place.href)).toEqual(["/dashboard", "/competition", "/team", "/build", "/business"]);
  });

  it("place a page by its hub, and old tool URLs by the hub they moved into", () => {
    expect(placeForPath("/dashboard")).toBe("home");
    expect(placeForPath("/competition")).toBe("competition");
    expect(placeForPath("/team/calendar")).toBe("team");
    expect(placeForPath("/scouting")).toBe("competition");
    expect(placeForPath("/strategy")).toBe("competition");
    expect(placeForPath("/hours")).toBe("team");
    expect(placeForPath("/cad")).toBe("build");
    expect(placeForPath("/sponsorship")).toBe("business");
    expect(placeForPath("/media")).toBe("business");
  });

  it("place Business tools that live under /team/… in Business, as access does", () => {
    expect(placeForPath("/team/grants")).toBe("business");
    expect(placeForPath("/team/grants/calendar")).toBe("business");
    expect(placeForPath("/team/finance")).toBe("business");
    expect(placeForPath("/team/sponsors")).toBe("business");
    expect(placeForPath("/team/calendar")).toBe("team");
    expect(placeForPath("/team/admin")).toBe("team");
  });

  it("leave settings, account and help pages without a place", () => {
    expect(placeForPath("/account")).toBeNull();
    expect(placeForPath("/help")).toBeNull();
  });

  it("warms the five places and match day tools once, and never workspace", () => {
    expect(IDLE_PREFETCH_HREFS).toEqual([
      "/dashboard",
      "/competition",
      "/team",
      "/build",
      "/business",
      "/schedule",
      "/match-sim",
      "/strategy",
      "/ranking-projection",
      "/scouting",
    ]);
    expect(IDLE_PREFETCH_HREFS).not.toContain("/workspace");
  });

  it("hide what this person may not open", () => {
    expect(visiblePlaces((href) => href !== "/business").map((place) => place.id)).toEqual(["home", "competition", "team", "build"]);
  });
});
