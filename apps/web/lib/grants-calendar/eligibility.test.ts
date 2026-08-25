import { describe, expect, it } from "vitest";
import {
  alertMilestoneForClose,
  daysUntil,
  deadlineUrgency,
  matchOpportunities,
  matchOpportunity,
  teamAgeSeasons,
} from "./eligibility";
import type { GrantCalendarOpportunity, OrgGrantProfile } from "./types";

const NOW = new Date("2026-03-01T12:00:00.000Z");

function profile(overrides: Partial<OrgGrantProfile> = {}): OrgGrantProfile {
  return {
    orgId: "org-1",
    teamNumber: 1234,
    rookieYear: null,
    seasonYear: 2026,
    stateProv: null,
    country: null,
    titleI: null,
    nonprofit501c3: null,
    studentCount: null,
    mentorCount: null,
    ...overrides,
  };
}

function grant(overrides: Partial<GrantCalendarOpportunity> = {}): GrantCalendarOpportunity {
  return {
    id: "g-1",
    orgId: null,
    name: "Test Grant",
    funder: "Test Funder",
    url: null,
    opensOn: null,
    closesOn: null,
    typicalAmountUsd: null,
    eligibility: {},
    notes: null,
    isActive: true,
    ...overrides,
  };
}

describe("daysUntil / parseIsoDate", () => {
  it("counts whole days forward and backward from today", () => {
    expect(daysUntil("2026-03-15", NOW)).toBe(14);
    expect(daysUntil("2026-03-01", NOW)).toBe(0);
    expect(daysUntil("2026-02-20", NOW)).toBe(-9);
  });

  it("returns null for missing or unparseable dates instead of guessing", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("sometime in spring", NOW)).toBeNull();
  });

  it("reads a timestamptz-style value by its date prefix", () => {
    expect(daysUntil("2026-03-11T00:00:00.000Z", NOW)).toBe(10);
  });
});

describe("deadlineUrgency", () => {
  it("bands a close date into the same buckets the alerts fire on", () => {
    expect(deadlineUrgency({ opensOn: null, closesOn: "2026-03-03", now: NOW })).toBe("closing-3");
    expect(deadlineUrgency({ opensOn: null, closesOn: "2026-03-10", now: NOW })).toBe("closing-14");
    expect(deadlineUrgency({ opensOn: null, closesOn: "2026-03-25", now: NOW })).toBe("closing-30");
    expect(deadlineUrgency({ opensOn: null, closesOn: "2026-06-01", now: NOW })).toBe("open");
    expect(deadlineUrgency({ opensOn: null, closesOn: "2026-02-01", now: NOW })).toBe("closed");
  });

  it("distinguishes not-open-yet from open and from no dates at all", () => {
    expect(deadlineUrgency({ opensOn: "2026-05-01", closesOn: null, now: NOW })).toBe("not-open-yet");
    expect(deadlineUrgency({ opensOn: "2026-01-01", closesOn: null, now: NOW })).toBe("open");
    expect(deadlineUrgency({ opensOn: null, closesOn: null, now: NOW })).toBe("no-date");
  });
});

describe("teamAgeSeasons", () => {
  it("counts the rookie season as season 1", () => {
    expect(teamAgeSeasons(profile({ rookieYear: 2026, seasonYear: 2026 }))).toBe(1);
    expect(teamAgeSeasons(profile({ rookieYear: 2024, seasonYear: 2026 }))).toBe(3);
  });

  it("is null when either half is unrecorded", () => {
    expect(teamAgeSeasons(profile({ rookieYear: null }))).toBeNull();
    expect(teamAgeSeasons(profile({ rookieYear: 2024, seasonYear: null }))).toBeNull();
  });
});

describe("matchOpportunity — unknown is a first-class result", () => {
  it("says it does not know the Title I status rather than guessing eligible", () => {
    const match = matchOpportunity(profile({ titleI: null }), grant({ eligibility: { titleI: true } }), NOW);
    expect(match.eligible).toBe("unknown");
    expect(match.missingFields).toEqual(["titleI"]);
    expect(match.reasons[0].verdict).toBe("unknown");
    expect(match.reasons[0].detail).toContain("we don't know your Title I status");
  });

  it("says it does not know the rookie year rather than guessing ineligible", () => {
    const match = matchOpportunity(profile({ rookieYear: null }), grant({ eligibility: { teamAgeMax: 3 } }), NOW);
    expect(match.eligible).toBe("unknown");
    expect(match.missingFields).toEqual(["rookieYear"]);
  });

  it("names the region field it is missing", () => {
    const match = matchOpportunity(
      profile({ stateProv: null, country: null }),
      grant({ eligibility: { region: ["MA", "NH"] } }),
      NOW,
    );
    expect(match.eligible).toBe("unknown");
    expect(match.missingFields).toEqual(["stateProv"]);
    expect(match.reasons[0].detail).toContain("MA, NH");
  });

  it("collapses to ineligible as soon as one rule is definitively unmet, even alongside unknowns", () => {
    const match = matchOpportunity(
      profile({ rookieYear: 2019, seasonYear: 2026, titleI: null }),
      grant({ eligibility: { teamAgeMax: 3, titleI: true } }),
      NOW,
    );
    expect(match.eligible).toBe(false);
    expect(match.reasons.some((reason) => reason.verdict === "ineligible")).toBe(true);
    expect(match.reasons.some((reason) => reason.verdict === "unknown")).toBe(true);
  });

  it("is eligible only when every rule it evaluated passed on recorded data", () => {
    const match = matchOpportunity(
      profile({
        rookieYear: 2025,
        seasonYear: 2026,
        titleI: true,
        stateProv: "ma",
        studentCount: 12,
        mentorCount: 2,
      }),
      grant({
        eligibility: { teamAgeMax: 3, titleI: true, region: ["MA"], minStudentCount: 5, minMentorCount: 1 },
      }),
      NOW,
    );
    expect(match.eligible).toBe(true);
    expect(match.missingFields).toEqual([]);
    expect(match.reasons.every((reason) => reason.verdict === "eligible")).toBe(true);
  });

  it("treats a grant with no recorded restrictions as eligible and says so", () => {
    const match = matchOpportunity(profile(), grant({ eligibility: {} }), NOW);
    expect(match.eligible).toBe(true);
    expect(match.reasons).toHaveLength(1);
    expect(match.reasons[0].rule).toBe("none");
  });

  it("handles rookieOnly against a veteran team using recorded years", () => {
    const veteran = matchOpportunity(
      profile({ rookieYear: 2020, seasonYear: 2026 }),
      grant({ eligibility: { rookieOnly: true } }),
      NOW,
    );
    expect(veteran.eligible).toBe(false);
    expect(veteran.reasons[0].detail).toContain("season 7");

    const rookie = matchOpportunity(
      profile({ rookieYear: 2026, seasonYear: 2026 }),
      grant({ eligibility: { rookieOnly: true } }),
      NOW,
    );
    expect(rookie.eligible).toBe(true);
  });

  it("does not fabricate a verdict from an empty region list", () => {
    const match = matchOpportunity(profile(), grant({ eligibility: { region: [] } }), NOW);
    expect(match.eligible).toBe(true);
    expect(match.reasons[0].rule).toBe("none");
  });

  it("respects a rule that EXCLUDES Title I schools", () => {
    const match = matchOpportunity(profile({ titleI: true }), grant({ eligibility: { titleI: false } }), NOW);
    expect(match.eligible).toBe(false);
    expect(match.reasons[0].detail).toContain("Excludes Title I");
  });
});

describe("matchOpportunities — ranking", () => {
  it("puts the soonest deadline first and drops inactive rows", () => {
    const ranked = matchOpportunities(
      profile(),
      [
        grant({ id: "far", name: "Far", closesOn: "2026-08-01" }),
        grant({ id: "soon", name: "Soon", closesOn: "2026-03-02" }),
        grant({ id: "gone", name: "Gone", closesOn: "2026-01-01" }),
        grant({ id: "off", name: "Inactive", closesOn: "2026-03-02", isActive: false }),
      ],
      NOW,
    );
    expect(ranked.map((match) => match.opportunity.id)).toEqual(["soon", "far", "gone"]);
    expect(ranked.some((match) => match.opportunity.id === "off")).toBe(false);
  });

  it("prefers eligible over unknown over ineligible within the same urgency band", () => {
    const ranked = matchOpportunities(
      profile({ rookieYear: 2019, seasonYear: 2026, titleI: null }),
      [
        grant({ id: "unknown", name: "B unknown", closesOn: "2026-03-10", eligibility: { titleI: true } }),
        grant({ id: "no", name: "C no", closesOn: "2026-03-10", eligibility: { teamAgeMax: 2 } }),
        grant({ id: "yes", name: "A yes", closesOn: "2026-03-10" }),
      ],
      NOW,
    );
    expect(ranked.map((match) => match.opportunity.id)).toEqual(["yes", "unknown", "no"]);
  });

  it("keeps closed grants last but visible", () => {
    const ranked = matchOpportunities(
      profile(),
      [grant({ id: "closed", closesOn: "2025-12-01" }), grant({ id: "undated" })],
      NOW,
    );
    expect(ranked[ranked.length - 1].opportunity.id).toBe("closed");
  });
});

describe("alertMilestoneForClose", () => {
  it("returns the tightest band so a skipped cron run does not swallow the warning", () => {
    expect(alertMilestoneForClose("2026-03-31", NOW)).toBe(30);
    expect(alertMilestoneForClose("2026-03-28", NOW)).toBe(30);
    expect(alertMilestoneForClose("2026-03-15", NOW)).toBe(14);
    expect(alertMilestoneForClose("2026-03-04", NOW)).toBe(3);
    expect(alertMilestoneForClose("2026-03-01", NOW)).toBe(3);
  });

  it("is null when undated, far out, or already closed", () => {
    expect(alertMilestoneForClose(null, NOW)).toBeNull();
    expect(alertMilestoneForClose("2026-06-01", NOW)).toBeNull();
    expect(alertMilestoneForClose("2026-02-28", NOW)).toBeNull();
  });
});
