import { describe, expect, it } from "vitest";
import { composeGrantAnswer, composeSponsorEmail } from "./compose";
import type { SponsorInput, WriterProfile } from "./types";

function profile(overrides: Partial<WriterProfile> = {}): WriterProfile {
  return {
    teamName: "Circuit Breakers",
    teamNumber: 1234,
    region: "Portland, OR",
    mission: "We turn students into engineers.",
    achievements: ["won a regional", "logged 400 outreach hours", "grew to 40 students"],
    fundingNeed: "registration and swerve modules",
    fundingAskUsd: 2500,
    tone: "warm",
    ...overrides,
  };
}

function sponsor(overrides: Partial<SponsorInput> = {}): SponsorInput {
  return {
    sponsorName: "Acme Robotics",
    contactName: null,
    tier: null,
    askAmountUsd: null,
    priorAmountUsd: null,
    senderName: null,
    senderRole: null,
    ...overrides,
  };
}

describe("composeSponsorEmail", () => {
  it("includes team handle in the subject and the sponsor name in the body", () => {
    const email = composeSponsorEmail("cold_intro", profile(), sponsor({ sponsorName: "Acme Robotics" }));
    expect(email.subject).toContain("Circuit Breakers");
    expect(email.subject).toContain("FRC Team 1234");
    expect(email.body).toContain("Acme Robotics");
  });

  it("uses the contact name in the greeting when provided", () => {
    const email = composeSponsorEmail("sponsorship_ask", profile(), sponsor({ contactName: "Dr. Lee" }));
    expect(email.body.startsWith("Dear Dr. Lee,")).toBe(true);
  });

  it("puts the ask amount and tier into a sponsorship ask", () => {
    const email = composeSponsorEmail(
      "sponsorship_ask",
      profile(),
      sponsor({ askAmountUsd: 5000, tier: "Gold" }),
    );
    expect(email.body).toContain("$5,000");
    expect(email.body.toLowerCase()).toContain("gold");
  });

  it("references prior support in a renewal", () => {
    const email = composeSponsorEmail("renewal", profile(), sponsor({ priorAmountUsd: 3000 }));
    expect(email.subject.toLowerCase()).toContain("renew");
    expect(email.body).toContain("$3,000");
  });

  it("thanks for a specific contribution in a thank-you", () => {
    const email = composeSponsorEmail("thank_you", profile(), sponsor({ priorAmountUsd: 1000 }));
    expect(email.subject.toLowerCase()).toContain("thank");
    expect(email.body).toContain("$1,000");
  });

  it("signs off with the sender and team, and varies by tone", () => {
    const warm = composeSponsorEmail("cold_intro", profile({ tone: "warm" }), sponsor({ senderName: "Sam", senderRole: "Captain" }));
    expect(warm.body).toContain("With gratitude,");
    expect(warm.body).toContain("Sam, Captain");
    const pro = composeSponsorEmail("cold_intro", profile({ tone: "professional" }), sponsor());
    expect(pro.body).toContain("Sincerely,");
  });

  it("degrades gracefully with a sparse profile", () => {
    const email = composeSponsorEmail(
      "cold_intro",
      profile({ teamNumber: null, region: null, mission: null, achievements: [] }),
      sponsor(),
    );
    expect(email.subject).toContain("Circuit Breakers");
    expect(email.body).not.toContain("FRC Team null");
    expect(email.body).not.toContain("undefined");
  });
});

describe("composeGrantAnswer", () => {
  it("weaves mission, achievements, and the prompt into a draft", () => {
    const answer = composeGrantAnswer(profile(), { prompt: "How will you use these funds?", charLimit: null, focus: "general" });
    expect(answer).toContain("Circuit Breakers");
    expect(answer).toContain("How will you use these funds?");
    expect(answer.toLowerCase()).toContain("outreach hours".toLowerCase());
  });

  it("adapts to the focus", () => {
    const impact = composeGrantAnswer(profile(), { prompt: "", charLimit: null, focus: "impact" });
    expect(impact.toLowerCase()).toContain("community impact");
    const inclusion = composeGrantAnswer(profile(), { prompt: "", charLimit: null, focus: "inclusion" });
    expect(inclusion.toLowerCase()).toContain("inclusion");
  });

  it("respects a character limit with a trim note", () => {
    const answer = composeGrantAnswer(profile(), { prompt: "x", charLimit: 120, focus: "general" });
    const firstLine = answer.split("\n\n")[0] ?? "";
    expect(firstLine.length).toBeLessThanOrEqual(120);
    expect(answer).toContain("Trimmed to 120 characters");
  });
});
