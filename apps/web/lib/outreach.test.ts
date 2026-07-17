import { describe, expect, it } from "vitest";
import { draftOutreachMessage } from "./outreach";

const baseContext = { teamName: "Vantage Robotics", teamNumber: 9999, seasonYear: 2027 };

describe("outreach message drafting", () => {
  it("drafts a thank-you referencing the contribution amount", () => {
    const draft = draftOutreachMessage("thank_you", {
      ...baseContext,
      sponsor: { name: "Acme Corp", contactName: "Jamie" },
      contributionSummary: { totalUsd: 2500 },
    });
    expect(draft.subject).toContain("Vantage Robotics");
    expect(draft.body).toContain("Jamie");
    expect(draft.body).toContain("2,500");
  });

  it("drafts a renewal ask mentioning the upcoming season", () => {
    const draft = draftOutreachMessage("renewal_ask", { ...baseContext, sponsor: { name: "Acme Corp" } });
    expect(draft.subject).toContain("2027");
  });

  it("drafts a grant follow-up referencing the funder and amount", () => {
    const draft = draftOutreachMessage("grant_followup", {
      ...baseContext,
      grant: { name: "STEM Innovation Grant", funder: "Local Foundation", amountRequestedUsd: 5000 },
    });
    expect(draft.body).toContain("Local Foundation");
    expect(draft.body).toContain("5,000");
  });

  it("falls back gracefully when sponsor/grant context is missing", () => {
    const draft = draftOutreachMessage("new_prospect_intro", baseContext);
    expect(draft.body).toContain("your organization");
  });

  it("returns an empty body for custom drafts, leaving it to the user", () => {
    expect(draftOutreachMessage("custom", baseContext).body).toBe("");
  });
});
