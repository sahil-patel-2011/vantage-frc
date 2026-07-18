import { describe, expect, it } from "vitest";
import {
  buildWhoWeAreSeed,
  emptyBackgroundProfile,
  formatOrgLocation,
  parseBackgroundSave,
  preferMission,
  preferRegion,
} from "./team-background";

describe("formatOrgLocation", () => {
  it("joins city and state", () => {
    expect(formatOrgLocation("Portland", "OR")).toBe("Portland, OR");
  });

  it("handles partial location", () => {
    expect(formatOrgLocation("Portland", null)).toBe("Portland");
    expect(formatOrgLocation(null, "OR")).toBe("OR");
    expect(formatOrgLocation(null, null)).toBeNull();
  });
});

describe("buildWhoWeAreSeed", () => {
  it("skips empty profiles", () => {
    expect(
      buildWhoWeAreSeed(
        { city: null, stateProv: null, description: null, orgName: "Us", teamNumber: 1234 },
        emptyBackgroundProfile(),
      ),
    ).toBeNull();
  });

  it("weaves location and description for this org only", () => {
    const seed = buildWhoWeAreSeed(
      {
        city: "Portland",
        stateProv: "OR",
        description: "A student-led STEM program serving our district.",
        orgName: "Circuit Breakers",
        teamNumber: 1234,
      },
      { ...emptyBackgroundProfile(), mission: "We turn students into engineers." },
    );
    expect(seed).toContain("FRC Team 1234");
    expect(seed).toContain("Portland, OR");
    expect(seed).toContain("student-led STEM");
    expect(seed).toContain("turn students into engineers");
  });
});

describe("prefer merges", () => {
  it("prefers background mission, then org description, then writer", () => {
    expect(preferMission("bg", "desc", "writer")).toBe("bg");
    expect(preferMission(null, "desc", "writer")).toBe("desc");
    expect(preferMission(null, null, "writer")).toBe("writer");
  });

  it("prefers writer region over org city/state", () => {
    expect(preferRegion("Custom Region", "Portland", "OR")).toBe("Custom Region");
    expect(preferRegion(null, "Portland", "OR")).toBe("Portland, OR");
  });
});

describe("parseBackgroundSave", () => {
  it("trims and nulls empty strings", () => {
    const parsed = parseBackgroundSave({
      city: " Portland ",
      stateProv: " OR ",
      description: "  ",
      mission: "Serve students",
    });
    expect(parsed.city).toBe("Portland");
    expect(parsed.stateProv).toBe("OR");
    expect(parsed.description).toBeNull();
    expect(parsed.mission).toBe("Serve students");
  });
});
