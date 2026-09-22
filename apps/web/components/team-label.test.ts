import { describe, expect, it } from "vitest";
import { orgLabelFor, orgNameAddsDetail, teamLabelFor, teamProseLabel } from "./app-shell-model";

/**
 * "Team 6925 · Team 6925" was on the top bar of every page.
 *
 * Most teams name their workspace after their number, and the label put the
 * number in front of that name unconditionally. The result reads as a
 * rendering fault rather than as a name, and it appeared twice more — in the
 * navigation drawer and under the big number on Home.
 */

describe("orgNameAddsDetail", () => {
  it("is false when the name is just the number again", () => {
    expect(orgNameAddsDetail(6925, "Team 6925")).toBe(false);
    expect(orgNameAddsDetail(6925, "6925")).toBe(false);
    expect(orgNameAddsDetail(6925, "team 6925")).toBe(false);
    expect(orgNameAddsDetail(6925, "TEAM-6925")).toBe(false);
    expect(orgNameAddsDetail(6925, "  Team  6925  ")).toBe(false);
  });

  it("is true for a name that carries something the number does not", () => {
    expect(orgNameAddsDetail(6925, "Cyber Falcons")).toBe(true);
    expect(orgNameAddsDetail(254, "Cheesy Poofs")).toBe(true);
    // "Robotics" is a real part of the name, so this one survives.
    expect(orgNameAddsDetail(6925, "Team 6925 Robotics")).toBe(true);
  });

  it("is false for nothing at all", () => {
    expect(orgNameAddsDetail(6925, null)).toBe(false);
    expect(orgNameAddsDetail(6925, "")).toBe(false);
    expect(orgNameAddsDetail(6925, "   ")).toBe(false);
  });

  it("keeps a name when there is no number to compare it against", () => {
    expect(orgNameAddsDetail(null, "Cyber Falcons")).toBe(true);
  });

  it("does not mistake a different number for the same one", () => {
    // Two teams under one program is a real thing and both must stay visible.
    expect(orgNameAddsDetail(6925, "Team 1234")).toBe(true);
  });
});

describe("teamLabelFor", () => {
  it("says the team once", () => {
    expect(teamLabelFor(6925, "Team 6925")).toBe("Team 6925");
    expect(teamLabelFor(6925, "6925")).toBe("Team 6925");
  });

  it("keeps a real name alongside the number", () => {
    expect(teamLabelFor(254, "Cheesy Poofs")).toBe("Team 254 · Cheesy Poofs");
  });

  it("falls back to the number alone", () => {
    expect(teamLabelFor(6925, null)).toBe("Team 6925");
  });

  it("falls back to the name alone", () => {
    expect(teamLabelFor(null, "Cyber Falcons")).toBe("Cyber Falcons");
  });

  it("returns nothing when it knows nothing", () => {
    expect(teamLabelFor(null, null)).toBeNull();
    expect(teamLabelFor(null, "  ")).toBeNull();
  });
});

describe("orgLabelFor", () => {
  it("no longer renders the team twice", () => {
    expect(orgLabelFor({ teamNumber: 6925, orgName: "Team 6925" }, "org")).toBe("Team 6925");
  });

  it("still shows a named team in full", () => {
    expect(orgLabelFor({ teamNumber: 254, orgName: "Cheesy Poofs" }, "org")).toBe(
      "Team 254 · Cheesy Poofs",
    );
  });

  it("keeps the signed-out and no-team wording", () => {
    expect(orgLabelFor({}, "")).toBe("No team selected");
    expect(orgLabelFor({}, "org")).toBe("This team");
  });
});

describe("teamProseLabel", () => {
  it("does not print the team twice mid-sentence", () => {
    // "Parts and materials stock … for Team 6925 (Team 6925)." shipped on
    // Inventory, and the same shape was on eleven other page descriptions.
    expect(teamProseLabel(6925, "Team 6925")).toBe("Team 6925");
    expect(teamProseLabel(6925, "6925")).toBe("Team 6925");
    expect(teamProseLabel(6925, "TEAM-6925")).toBe("Team 6925");
  });

  it("keeps a real name and puts the number beside it", () => {
    expect(teamProseLabel(254, "Cheesy Poofs")).toBe("Cheesy Poofs (Team 254)");
    expect(teamProseLabel(6925, "Team 6925 Robotics")).toBe("Team 6925 Robotics (Team 6925)");
  });

  it("falls back to whichever half it has", () => {
    expect(teamProseLabel(6925, null)).toBe("Team 6925");
    expect(teamProseLabel(6925, "   ")).toBe("Team 6925");
    expect(teamProseLabel(null, "Cyber Falcons")).toBe("Cyber Falcons");
    expect(teamProseLabel(null, null)).toBeNull();
  });

  it("is the prose spelling, not the label spelling", () => {
    // The `·` separator belongs on the top bar, not in the middle of a
    // sentence — that is what teamLabelFor is for.
    expect(teamProseLabel(254, "Cheesy Poofs")).not.toContain("·");
    expect(teamLabelFor(254, "Cheesy Poofs")).toContain("·");
  });
});
