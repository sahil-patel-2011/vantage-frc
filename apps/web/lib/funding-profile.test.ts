import { describe, expect, it } from "vitest";
import {
  fundingPathsReady,
  isFundingAffiliation,
  parseFundingProfileSave,
} from "./funding-profile";

describe("funding-profile", () => {
  it("accepts known affiliations only", () => {
    expect(isFundingAffiliation("private_school")).toBe(true);
    expect(isFundingAffiliation("community")).toBe(true);
    expect(isFundingAffiliation("other")).toBe(false);
    expect(isFundingAffiliation(null)).toBe(false);
  });

  it("requires at least one funding path", () => {
    expect(fundingPathsReady({ schoolFunded: false, outsideGrants: false, sponsorsAllowed: false })).toBe(
      false,
    );
    expect(fundingPathsReady({ schoolFunded: true, outsideGrants: false, sponsorsAllowed: false })).toBe(
      true,
    );
  });

  it("parses a valid save payload", () => {
    expect(
      parseFundingProfileSave({
        teamAffiliation: "public_school",
        schoolFunded: true,
        outsideGrants: true,
        sponsorsAllowed: false,
      }),
    ).toEqual({
      teamAffiliation: "public_school",
      schoolFunded: true,
      outsideGrants: true,
      sponsorsAllowed: false,
    });
  });

  it("rejects empty funding paths", () => {
    expect(() =>
      parseFundingProfileSave({
        teamAffiliation: "community",
        schoolFunded: false,
        outsideGrants: false,
        sponsorsAllowed: false,
      }),
    ).toThrow(/at least one funding path/i);
  });
});
