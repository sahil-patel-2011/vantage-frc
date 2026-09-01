import { describe, expect, it } from "vitest";
import {
  ageBandLabel,
  ageYearsFromDob,
  buildPersonalPromptBlock,
  buildShareableTeamNote,
  parseTeamBraindump,
  stripPersonalIdentifiers,
} from "./prompt-context";

describe("prompt context personalization", () => {
  it("derives age without exposing the birthday string", () => {
    expect(ageYearsFromDob("2011-01-15", new Date("2026-08-23T12:00:00Z"))).toBe(15);
    expect(ageBandLabel(15)).toMatch(/high-school/i);
    const block = buildPersonalPromptBlock({
      ageYears: 15,
      ageBand: ageBandLabel(15),
      teamRole: "student",
      crewRole: "cad",
      roleDescription: "CAD lead",
      teamBraindump: "We run a 2-speed swerve and the elevator binds at 40 deg.",
      primaryFocus: "build",
    });
    expect(block).toMatch(/high-school/);
    expect(block).not.toMatch(/2011-01-15/);
    expect(block).toMatch(/swerve/);
  });

  it("strips contact details before team share", () => {
    const shared = buildShareableTeamNote({
      crewRole: "cad",
      braindump: "Intake uses 2 NEOs. Call me at 555-123-4567 or sahil@team.org @driver",
    });
    expect(shared).toMatch(/NEOs/);
    expect(shared).not.toMatch(/555-123-4567|sahil@team.org|@driver/);
    expect(stripPersonalIdentifiers("none")).toBe("none");
  });

  it("rejects oversized braindumps", () => {
    expect(parseTeamBraindump("  we use MK4i  ")).toBe("we use MK4i");
    expect(() => parseTeamBraindump("x".repeat(4001))).toThrow(/4000/);
  });
});
