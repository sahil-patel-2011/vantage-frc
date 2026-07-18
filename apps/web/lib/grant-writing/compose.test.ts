import { describe, expect, it } from "vitest";
import { composeGrantNarrative, validateGuidedFields } from "./compose";
import type { GrantOrgEvidence } from "../grant-assist/types";

const ctx: GrantOrgEvidence = {
  orgId: "org-1",
  orgName: "Circuit Breakers",
  teamNumber: 1234,
  city: "Portland",
  stateProv: "OR",
  description: "A student-led STEM program serving our district.",
  location: "Portland, OR",
  seasonYear: 2026,
  impact: { activities: 2, hours: 12, peopleReached: 80 },
  communityHours: 12,
  seasonGoals: [],
  awards: [],
};

describe("composeGrantNarrative", () => {
  it("weaves onboarding location and description into the opening", () => {
    const result = composeGrantNarrative({
      templateKey: "community_foundation",
      funderName: "Local Foundation",
      askAmountUsd: 1500,
      fields: {
        need: "We need shop tools for safe fabrication.",
        impact: "",
        budget: "Tools and PPE totaling $1,500.",
        timeline: "Order in August; use through competition season.",
      },
      ctx,
    });
    expect(result.body).toContain("Portland, OR");
    expect(result.body).toContain("student-led STEM");
    expect(result.body).toContain("FRC Team 1234");
    expect(result.body).not.toMatch(/Team 1678|another org/i);
  });
});

describe("validateGuidedFields", () => {
  it("requires at least one field", () => {
    expect(validateGuidedFields({ need: "", impact: "", budget: "", timeline: "" }).ok).toBe(false);
    expect(validateGuidedFields({ need: "x", impact: "", budget: "", timeline: "" }).ok).toBe(true);
  });
});
