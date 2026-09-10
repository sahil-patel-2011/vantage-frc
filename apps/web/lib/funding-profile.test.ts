import { describe, expect, it } from "vitest";
import {
  businessDefaultTab,
  flagsFromFundingModel,
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
      fundingModel: "school_funded_no_sponsors",
    });
  });

  it("prefers an explicit funding model over the three checkboxes", () => {
    expect(
      parseFundingProfileSave({
        teamAffiliation: "community",
        fundingModel: "self_funded",
      }).fundingModel,
    ).toBe("self_funded");
  });

  it("rejects empty funding paths", () => {
    expect(() =>
      parseFundingProfileSave({
        teamAffiliation: "community",
        schoolFunded: false,
        outsideGrants: false,
        sponsorsAllowed: false,
      }),
    ).toThrow(/how the team is funded/i);
  });

  it("maps each funding model to flags and a Business landing tab", () => {
    expect(flagsFromFundingModel("self_funded")).toEqual({
      schoolFunded: false,
      outsideGrants: true,
      sponsorsAllowed: false,
    });
    expect(flagsFromFundingModel("school_funded_no_sponsors").sponsorsAllowed).toBe(false);
    expect(businessDefaultTab("self_funded")).toBe("evidence");
    expect(businessDefaultTab("school_funded_no_sponsors")).toBe("finance");
    expect(businessDefaultTab("sponsored")).toBe("sponsors");
    expect(businessDefaultTab("school_related_sponsored")).toBe("sponsors");
    expect(businessDefaultTab(null)).toBe("overview");
  });
});
