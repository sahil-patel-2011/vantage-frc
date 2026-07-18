import { describe, expect, it } from "vitest";
import {
  buildLocalPitchDraft,
  buildPitchBundle,
  buildPitchContextSources,
  parseAiPitchResponse,
  pitchDraftTitle,
  type PitchBusinessFacts,
  type PitchDraftInput,
} from "./ai-pitch";
import type { WriterProfile } from "./types";

function profile(overrides: Partial<WriterProfile> = {}): WriterProfile {
  return {
    teamName: "Circuit Breakers",
    teamNumber: 1234,
    region: "Portland, OR",
    mission: "We turn students into engineers.",
    achievements: ["won a regional", "logged 400 outreach hours"],
    fundingNeed: "registration and travel",
    fundingAskUsd: 2500,
    tone: "warm",
    ...overrides,
  };
}

function business(overrides: Partial<PitchBusinessFacts> = {}): PitchBusinessFacts {
  return {
    orgId: "org-aaa",
    seasonYear: 2026,
    impact: { activities: 12, hours: 48, peopleReached: 900 },
    awards: [{ awardName: "Imagery Award", eventName: "PNW District", seasonYear: 2025 }],
    fundraisingGoalUsd: 40_000,
    seasonSponsorIncomeUsd: 12_500,
    activeSponsorCount: 4,
    ...overrides,
  };
}

function pitch(overrides: Partial<PitchDraftInput> = {}): PitchDraftInput {
  return {
    kind: "sponsorship_ask",
    profile: profile(),
    sponsor: {
      sponsorName: "Acme Robotics",
      contactName: "Dr. Lee",
      tier: "Gold",
      askAmountUsd: 5000,
      priorAmountUsd: null,
      senderName: "Alex",
      senderRole: "Captain",
    },
    grant: null,
    business: business(),
    ...overrides,
  };
}

describe("buildPitchContextSources", () => {
  it("tags every source with this org id and never invents foreign org ids", () => {
    const sources = buildPitchContextSources(pitch());
    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const source of sources) {
      expect(source.id).toContain("org-aaa");
      expect(source.content).toContain("org-aaa");
      expect(source.content).not.toContain("org-bbb");
    }
  });

  it("includes only the supplied business facts", () => {
    const sources = buildPitchContextSources(
      pitch({
        business: business({
          orgId: "org-only",
          impact: null,
          awards: [],
          fundraisingGoalUsd: null,
          seasonSponsorIncomeUsd: null,
          activeSponsorCount: 0,
        }),
      }),
    );
    const biz = sources.find((s) => s.id.startsWith("writer-business:"));
    expect(biz?.content).toContain("org-only");
    expect(biz?.content).not.toContain("Imagery Award");
    expect(biz?.content).toContain('"activeSponsorCount":0');
  });
});

describe("buildLocalPitchDraft", () => {
  it("weaves org impact and awards into the sponsor email body", () => {
    const draft = buildLocalPitchDraft(pitch());
    expect(draft.subject).toContain("Circuit Breakers");
    expect(draft.body).toContain("Acme Robotics");
    expect(draft.body).toContain("12 community activities");
    expect(draft.body).toContain("Imagery Award");
    expect(draft.body).toContain("$12,500");
  });

  it("does not fabricate impact when the org has none", () => {
    const draft = buildLocalPitchDraft(
      pitch({ business: business({ impact: null, awards: [], fundraisingGoalUsd: null, seasonSponsorIncomeUsd: null }) }),
    );
    expect(draft.body).not.toContain("community activities");
    expect(draft.body).toContain("Acme Robotics");
  });
});

describe("parseAiPitchResponse", () => {
  const fallback = { subject: "Fallback subject", body: "Fallback body that is long enough to use." };

  it("parses SUBJECT/BODY formatted model output", () => {
    const parsed = parseAiPitchResponse(
      "SUBJECT: Partner with us\n\nBODY:\nDear Dr. Lee,\n\nWe would love your support this season.\n\nThanks,",
      fallback,
    );
    expect(parsed.source).toBe("ai");
    expect(parsed.subject).toBe("Partner with us");
    expect(parsed.body).toContain("Dear Dr. Lee");
  });

  it("falls back to the template when the model returns nothing useful", () => {
    expect(parseAiPitchResponse("No response.", fallback).source).toBe("template");
    expect(parseAiPitchResponse("short", fallback).source).toBe("template");
  });
});

describe("buildPitchBundle + title", () => {
  it("builds a metered message that forbids fabricating other-org data", () => {
    const bundle = buildPitchBundle(pitch());
    expect(bundle.message).toMatch(/ONLY the org-scoped/i);
    expect(bundle.message).toMatch(/Do not invent/i);
    expect(bundle.localBody.length).toBeGreaterThan(40);
    expect(pitchDraftTitle("sponsorship_ask", "Acme")).toBe("Sponsorship ask — Acme");
  });
});
