import { describe, expect, it } from "vitest";
import {
  BAR_SLOTS,
  DEFAULT_PINS,
  PIN_LIMIT,
  TEAM_RESOURCES_PIN,
  defaultPinHrefs,
  isDefaultPinSelection,
  isValidPinSelection,
  legacyBarFor,
  movePin,
  pinCatalog,
  pinDefinition,
  placePin,
  resolvePins,
  resolveStoredPins,
  togglePin,
} from "./pins";
import { defaultIslandHrefs } from "./island-preferences";
import { pathAllowedByHubAccess } from "./hub-access-filter";

describe("your apps: the stock pins", () => {
  it("keep the bottom bar's stock four first, then My Day, Tasks and Team resources", () => {
    expect(resolvePins(defaultPinHrefs()).map((pin) => pin.label)).toEqual([
      "Home", "Scout", "Teams", "Match plan", "My Day", "Tasks", "Team resources",
    ]);
    expect(DEFAULT_PINS.slice(0, BAR_SLOTS)).toEqual(defaultIslandHrefs());
    expect(DEFAULT_PINS).toContain(TEAM_RESOURCES_PIN.href);
    expect(TEAM_RESOURCES_PIN).toEqual({ href: "/learn/team", label: "Team resources", icon: "book" });
  });
});

describe("your apps: the catalog", () => {
  it("groups every pinnable place the way the menu does, each place once", () => {
    const groups = pinCatalog();
    expect(groups.map((group) => group.label)).toEqual(["Everyday", "Competition", "Team", "Build", "Business", "AI"]);
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of DEFAULT_PINS) expect(hrefs).toContain(href);
    // The bottom bar's short names win: "Team chat", not a bare "Chat".
    expect(pinDefinition("/team?tab=messages")?.label).toBe("Team chat");
    expect(groups.find((group) => group.id === "team")?.items.map((item) => item.label)).toContain("Team resources");
  });

  it("never offers a place this member can't open", () => {
    const access = [{ hubId: "competition" as const, allowedTabIds: ["scouting"] }];
    const groups = pinCatalog((href) => pathAllowedByHubAccess(href, access));
    const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toContain("/competition?tab=scouting");
    expect(hrefs).not.toContain("/competition?tab=strategy");
    expect(hrefs).not.toContain("/business?tab=finance");
  });
});

describe("your apps: validation", () => {
  it("accepts one to eight different places, in any order", () => {
    expect(isValidPinSelection(["/dashboard"])).toBe(true);
    expect(isValidPinSelection(defaultPinHrefs())).toBe(true);
    const eight = pinCatalog().flatMap((group) => group.items.map((item) => item.href)).slice(0, PIN_LIMIT);
    expect(isValidPinSelection(eight)).toBe(true);
  });

  it("refuses nothing, too many, duplicates (also through old aliases) and unknown places", () => {
    expect(isValidPinSelection([])).toBe(false);
    expect(isValidPinSelection(null)).toBe(false);
    const nine = pinCatalog().flatMap((group) => group.items.map((item) => item.href)).slice(0, PIN_LIMIT + 1);
    expect(isValidPinSelection(nine)).toBe(false);
    expect(isValidPinSelection(["/dashboard", "/dashboard"])).toBe(false);
    expect(isValidPinSelection(["/scout", "/competition?tab=scouting"])).toBe(false);
    expect(isValidPinSelection(["/dashboard", "/admin"])).toBe(false);
    expect(isValidPinSelection(["/dashboard", 4])).toBe(false);
  });
});

describe("your apps: saved values from before pins", () => {
  it("gives the stock pins to people who never changed their bar", () => {
    expect(resolveStoredPins(null, [])).toEqual(defaultPinHrefs());
    expect(resolveStoredPins(null, null)).toEqual(defaultPinHrefs());
    // The old stock four, saved by "Reset shortcuts", is still "not customized".
    expect(resolveStoredPins(null, defaultIslandHrefs())).toEqual(defaultPinHrefs());
  });

  it("keeps a custom bottom bar exactly as it was, old aliases included", () => {
    const custom = ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"];
    expect(resolveStoredPins(null, custom)).toEqual(custom);
    expect(resolveStoredPins(null, ["/dashboard", "/competition", "/rankings", "/ai?tab=chat"])).toEqual([
      "/dashboard", "/competition?tab=command", "/rankings", "/ai?tab=chat",
    ]);
    expect(resolvePins(resolveStoredPins(null, custom)).map((pin) => pin.label)).toEqual(["Build", "Ask AI", "Team chat", "Business"]);
  });

  it("prefers the saved pins over the old bar, and ignores a broken list", () => {
    expect(resolveStoredPins(["/dashboard", "/files"], ["/build", "/ai?tab=chat", "/team?tab=messages", "/business"])).toEqual(["/dashboard", "/files"]);
    expect(resolveStoredPins(["/nowhere"], [])).toEqual(defaultPinHrefs());
  });

  it("keeps the old bar column in step with the first four pins", () => {
    expect(legacyBarFor(["/build", "/ai?tab=chat", "/team?tab=messages", "/business", "/files"])).toEqual([
      "/build", "/ai?tab=chat", "/team?tab=messages", "/business",
    ]);
    // Fewer than four, or a first four the old bar can't show: the empty default.
    expect(legacyBarFor(["/dashboard", "/files"])).toEqual([]);
    expect(legacyBarFor(["/dashboard", "/learn/team", "/files", "/rankings"])).toEqual([]);
  });

  it("knows the stock pins whatever way they were spelled", () => {
    expect(isDefaultPinSelection(defaultPinHrefs())).toBe(true);
    expect(isDefaultPinSelection([...defaultPinHrefs()].reverse())).toBe(false);
    expect(isDefaultPinSelection(defaultPinHrefs().slice(0, 4))).toBe(false);
  });
});

describe("your apps: editing", () => {
  it("adds at the end, removes, and refuses a ninth pin or removing the last", () => {
    let pins = ["/dashboard"];
    expect(togglePin(pins, "/dashboard")).toEqual({ pins: ["/dashboard"], error: "Keep at least one app pinned." });
    pins = togglePin(pins, "/files").pins;
    expect(pins).toEqual(["/dashboard", "/files"]);
    expect(togglePin(pins, "/scout").pins).toEqual(["/dashboard", "/files", "/competition?tab=scouting"]);
    expect(togglePin(pins, "/files").pins).toEqual(["/dashboard"]);
    expect(togglePin(pins, "/admin").error).toBeTruthy();
    const full = pinCatalog().flatMap((group) => group.items.map((item) => item.href)).slice(0, PIN_LIMIT);
    const overflow = togglePin(full, pinCatalog().flatMap((group) => group.items.map((item) => item.href))[PIN_LIMIT]!);
    expect(overflow.error).toContain(`${PIN_LIMIT} apps`);
    expect(overflow.pins).toEqual(full);
  });

  it("reorders by a step (buttons, keyboard) or to a place (drag)", () => {
    const pins = ["/dashboard", "/files", "/rankings", "/learn/team"];
    expect(movePin(pins, "/rankings", -1)).toEqual(["/dashboard", "/rankings", "/files", "/learn/team"]);
    expect(movePin(pins, "/dashboard", -1)).toEqual(pins);
    expect(movePin(pins, "/learn/team", 1)).toEqual(pins);
    expect(movePin(pins, "/nowhere", 1)).toEqual(pins);
    expect(placePin(pins, "/learn/team", 0)).toEqual(["/learn/team", "/dashboard", "/files", "/rankings"]);
    expect(placePin(pins, "/dashboard", 9)).toEqual(["/files", "/rankings", "/learn/team", "/dashboard"]);
  });
});
