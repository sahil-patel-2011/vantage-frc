import { describe, expect, it } from "vitest";
import { assessSustainability, levelLabel, topFactors } from "./risk";
import type { SustainabilitySignals } from "./types";

function signals(overrides: Partial<SustainabilitySignals> = {}): SustainabilitySignals {
  return {
    seasonYear: 2026,
    fundingSources: [],
    priorSeasonTotalUsd: null,
    expiringGrants: [],
    pipelineProspectCount: null,
    studentCount: null,
    mentorCount: null,
    ...overrides,
  };
}

describe("assessSustainability — thin data never produces a score", () => {
  it("returns unknown with a to-record list when nothing is recorded", () => {
    const result = assessSustainability(signals());
    expect(result.level).toBe("unknown");
    expect(result.factors).toEqual([]);
    expect(result.missingInputs.length).toBeGreaterThan(0);
    expect(result.missingInputs[0]).toContain("funding sources");
  });

  it("returns unknown when sources exist but no dollars were received", () => {
    const result = assessSustainability(
      signals({ fundingSources: [{ id: "a", name: "School", kind: "school", receivedUsd: 0 }] }),
    );
    expect(result.level).toBe("unknown");
    expect(result.totals.totalReceivedUsd).toBe(0);
  });

  it("names the roster fields it is missing so the mentor can fix it", () => {
    const result = assessSustainability(signals());
    expect(result.missingInputs.some((input) => input.includes("student roster"))).toBe(true);
    expect(result.missingInputs.some((input) => input.includes("mentors"))).toBe(true);
  });
});

describe("assessSustainability — concentration", () => {
  it("flags single-sponsor dependence at-risk and cites the exact share", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "Acme Corp", kind: "sponsor", receivedUsd: 6800 },
          { id: "b", name: "Bake sale", kind: "fundraiser", receivedUsd: 1600 },
          { id: "c", name: "School", kind: "school", receivedUsd: 1600 },
        ],
        pipelineProspectCount: 3,
      }),
      "org-1",
    );
    expect(result.level).toBe("at-risk");
    expect(result.totals.largestSourceSharePct).toBe(68);
    const concentration = result.factors.find((factor) => factor.key === "sponsor_concentration");
    expect(concentration?.severity).toBe("critical");
    expect(concentration?.headline).toContain("Acme Corp is 68% of your funding");
    expect(concentration?.evidence).toContain("$6,800");
    expect(concentration?.evidence).toContain("$10,000");
    expect(concentration?.nextAction).toContain("3 prospects");
  });

  it("uses the watch band between 40% and 60%", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "Acme", kind: "sponsor", receivedUsd: 5000 },
          { id: "b", name: "Beta", kind: "sponsor", receivedUsd: 3000 },
          { id: "c", name: "Gamma", kind: "grant", receivedUsd: 2000 },
        ],
        pipelineProspectCount: 0,
      }),
    );
    expect(result.level).toBe("watch");
    const concentration = result.factors.find((factor) => factor.key === "sponsor_concentration");
    expect(concentration?.severity).toBe("warning");
    expect(concentration?.nextAction).toContain("No prospects");
  });

  it("asks for pipeline data instead of inventing a prospect count", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [{ id: "a", name: "School district", kind: "school", receivedUsd: 9000 }],
        pipelineProspectCount: null,
      }),
    );
    const concentration = result.factors.find((factor) => factor.key === "sponsor_concentration");
    expect(concentration?.nextAction).toContain("Add prospects");
  });
});

describe("assessSustainability — source count", () => {
  it("treats exactly one funding source as critical", () => {
    const result = assessSustainability(
      signals({ fundingSources: [{ id: "a", name: "School", kind: "school", receivedUsd: 8000 }] }),
    );
    expect(result.level).toBe("at-risk");
    const count = result.factors.find((factor) => factor.key === "funding_source_count");
    expect(count?.severity).toBe("critical");
    expect(count?.headline).toContain("exactly 1 funding source");
  });

  it("reads three or more balanced sources as stable", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "Acme", kind: "sponsor", receivedUsd: 3400 },
          { id: "b", name: "Beta", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "School", kind: "school", receivedUsd: 3300 },
        ],
      }),
    );
    expect(result.level).toBe("stable");
    expect(result.factors.every((factor) => factor.severity === "neutral")).toBe(true);
  });

  it("lists the source names as evidence when below the healthy count", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "Acme", kind: "sponsor", receivedUsd: 3000 },
          { id: "b", name: "School", kind: "school", receivedUsd: 3000 },
        ],
      }),
    );
    const count = result.factors.find((factor) => factor.key === "funding_source_count");
    expect(count?.evidence).toBe("Acme, School.");
  });
});

describe("assessSustainability — the grant cliff", () => {
  it("flags an unreplaced grant expiring inside 60 days with its share of funding", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "Rookie grant", kind: "grant", receivedUsd: 5000 },
          { id: "b", name: "Acme", kind: "sponsor", receivedUsd: 3000 },
          { id: "c", name: "School", kind: "school", receivedUsd: 2000 },
        ],
        expiringGrants: [
          {
            id: "g1",
            name: "Rookie grant",
            amountUsd: 5000,
            endsOn: "2026-04-15",
            daysUntilEnd: 45,
            replaced: false,
          },
        ],
      }),
      "org-1",
    );
    expect(result.level).toBe("at-risk");
    const cliff = result.factors.find((factor) => factor.key === "expiring_grant");
    expect(cliff?.severity).toBe("critical");
    expect(cliff?.headline).toContain("ends in 45 days");
    expect(cliff?.evidence).toContain("50% of this season's recorded funding");
    expect(cliff?.href).toContain("/team/grants");
  });

  it("stays quiet about a grant that already has a recorded replacement", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 3400 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "C", kind: "school", receivedUsd: 3300 },
        ],
        expiringGrants: [
          { id: "g1", name: "A", amountUsd: 3400, endsOn: "2026-04-01", daysUntilEnd: 31, replaced: true },
        ],
      }),
    );
    expect(result.factors.some((factor) => factor.key === "expiring_grant")).toBe(false);
    expect(result.level).toBe("stable");
  });

  it("does not invent an amount when the grant's value is unrecorded", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 3400 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "C", kind: "school", receivedUsd: 3300 },
        ],
        expiringGrants: [
          { id: "g1", name: "Mystery grant", amountUsd: null, endsOn: "2026-06-01", daysUntilEnd: 92, replaced: false },
        ],
      }),
    );
    const cliff = result.factors.find((factor) => factor.key === "expiring_grant");
    expect(cliff?.severity).toBe("warning");
    expect(cliff?.evidence).not.toContain("$");
  });
});

describe("assessSustainability — year-over-year delta", () => {
  it("flags a steep drop with both season totals", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 2000 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 2000 },
          { id: "c", name: "C", kind: "school", receivedUsd: 2000 },
        ],
        priorSeasonTotalUsd: 12000,
      }),
    );
    const delta = result.factors.find((factor) => factor.key === "funding_delta");
    expect(delta?.severity).toBe("critical");
    expect(delta?.headline).toContain("down 50%");
    expect(delta?.evidence).toContain("$6,000");
    expect(delta?.evidence).toContain("$12,000");
    expect(delta?.evidence).toContain("2025");
  });

  it("emits no delta factor when there is no prior season on record", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 2000 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 2000 },
          { id: "c", name: "C", kind: "school", receivedUsd: 2000 },
        ],
        priorSeasonTotalUsd: null,
      }),
    );
    expect(result.factors.some((factor) => factor.key === "funding_delta")).toBe(false);
  });

  it("never flags growth", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 4000 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 4000 },
          { id: "c", name: "C", kind: "school", receivedUsd: 4000 },
        ],
        priorSeasonTotalUsd: 6000,
      }),
    );
    expect(result.factors.some((factor) => factor.key === "funding_delta")).toBe(false);
  });
});

describe("assessSustainability — roster signals only when recorded", () => {
  it("flags a one-mentor team", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 3400 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "C", kind: "school", receivedUsd: 3300 },
        ],
        mentorCount: 1,
      }),
    );
    expect(result.level).toBe("watch");
    expect(result.factors.find((factor) => factor.key === "mentor_count")?.headline).toContain("1 mentor");
  });

  it("says nothing about a roster it has no rows for", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 3400 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "C", kind: "school", receivedUsd: 3300 },
        ],
        mentorCount: null,
        studentCount: null,
      }),
    );
    expect(result.factors.some((factor) => factor.key === "mentor_count")).toBe(false);
    expect(result.factors.some((factor) => factor.key === "roster_size")).toBe(false);
  });
});

describe("presentation helpers", () => {
  it("every factor carries the number it came from", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [{ id: "a", name: "School", kind: "school", receivedUsd: 9000 }],
        priorSeasonTotalUsd: 15000,
        mentorCount: 1,
        studentCount: 4,
      }),
      "org-1",
    );
    for (const factor of result.factors) {
      expect(factor.evidence.length).toBeGreaterThan(0);
      expect(factor.nextAction.length).toBeGreaterThan(0);
    }
  });

  it("sorts critical factors first and returns the top two", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [{ id: "a", name: "School", kind: "school", receivedUsd: 9000 }],
        mentorCount: 1,
      }),
    );
    expect(result.factors[0].severity).toBe("critical");
    const top = topFactors(result);
    expect(top).toHaveLength(2);
    expect(top.every((factor) => factor.severity !== "neutral")).toBe(true);
  });

  it("falls back to neutral readings for a stable team rather than showing nothing", () => {
    const result = assessSustainability(
      signals({
        fundingSources: [
          { id: "a", name: "A", kind: "grant", receivedUsd: 3400 },
          { id: "b", name: "B", kind: "sponsor", receivedUsd: 3300 },
          { id: "c", name: "C", kind: "school", receivedUsd: 3300 },
        ],
      }),
    );
    expect(topFactors(result).length).toBe(2);
  });

  it("labels every level", () => {
    expect(levelLabel("stable")).toBe("Stable");
    expect(levelLabel("watch")).toBe("Watch");
    expect(levelLabel("at-risk")).toBe("At risk");
    expect(levelLabel("unknown")).toBe("Not enough recorded");
  });
});
