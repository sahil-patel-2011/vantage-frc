import { describe, expect, it } from "vitest";
import {
  annotateToolOutput,
  buildEngineeringBriefFromTools,
  calendarSeasonYear,
  planCadStrategyToolCalls,
  planChatToolCalls,
  resolveActiveSeasonYear,
  seasonYearFromEventKey,
} from "../src";

describe("resolveActiveSeasonYear", () => {
  it("prefers explicit seasonYear over event key and calendar", () => {
    expect(
      resolveActiveSeasonYear({
        seasonYear: 2027,
        activeEventKey: "2026nysu",
        now: new Date("2025-03-01T12:00:00Z"),
      }),
    ).toBe(2027);
  });

  it("uses events_ref-style year from active_event_key", () => {
    expect(seasonYearFromEventKey("2027nysu")).toBe(2027);
    expect(
      resolveActiveSeasonYear({
        activeEventKey: "2027nysu",
        now: new Date("2025-03-01T12:00:00Z"),
      }),
    ).toBe(2027);
  });

  it("falls back to matchKey year then FRC calendar season", () => {
    expect(resolveActiveSeasonYear({ matchKey: "2026nysu_qm12" })).toBe(2026);
    expect(calendarSeasonYear(new Date("2025-09-15T12:00:00Z"))).toBe(2026);
    expect(calendarSeasonYear(new Date("2026-02-01T12:00:00Z"))).toBe(2026);
  });
});

describe("season isolation fixtures", () => {
  const priorSeasonRules = {
    seasonYear: 2025,
    ruleNotes: [{ question: "2025 bumper rule?", answer: "old answer", ruleRef: "R100", status: "answered" }],
    constraints: ["2025 robots may not extend beyond 30 inches"],
  };
  const activeSeasonRules = {
    seasonYear: 2027,
    ruleNotes: [{ question: "2027 coral descoring?", answer: "", ruleRef: "G420", status: "open" }],
    constraints: ["2027 robots may not extend beyond 48 inches"],
  };

  it("planner locks kickoff/rules tools to active event season — ignores years in chat text", () => {
    const calls = planChatToolCalls("Compare to the 2025 robot and check frame perimeter rules", {
      capability: "strategy",
      activeEventKey: "2027nysu",
    });
    const seasonCalls = calls.filter((call) =>
      ["kickoff.intelligence", "kickoff.rules", "strategy.design", "rules.compliance"].includes(call.name),
    );
    expect(seasonCalls.length).toBeGreaterThan(0);
    for (const call of seasonCalls) {
      expect(call.input).toEqual(expect.objectContaining({ seasonYear: 2027 }));
    }
  });

  it("CAD brief planner uses activeEventKey season when seasonYear omitted", () => {
    const calls = planCadStrategyToolCalls("Engineering brief for intake", {
      matchKey: "2027nysu_qm12",
      activeEventKey: "2027nysu",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "kickoff.rules", input: { seasonYear: 2027 } }),
        expect.objectContaining({ name: "strategy.design", input: { seasonYear: 2027 } }),
      ]),
    );
  });

  it("CAD brief builder drops prior-season kickoff/rules facts", () => {
    const brief = buildEngineeringBriefFromTools({
      request: "Design a legal intake",
      activeSeasonYear: 2027,
      context: [
        {
          type: "module_fact",
          id: "kickoff.rules:prior",
          importance: 1,
          content: JSON.stringify({
            tool: "kickoff.rules",
            status: "ok",
            classification: "researched_claim",
            data: priorSeasonRules,
          }),
        },
        {
          type: "module_fact",
          id: "kickoff.rules:active",
          importance: 1,
          content: JSON.stringify({
            tool: "kickoff.rules",
            status: "ok",
            classification: "researched_claim",
            data: activeSeasonRules,
          }),
        },
      ],
    });
    expect(brief.constraints.some((row) => /30 inches|2025/.test(row))).toBe(false);
    expect(brief.constraints.some((row) => /48 inches|2027/.test(row))).toBe(true);
    expect(brief.risks.some((row) => /coral descoring|G420/i.test(row))).toBe(true);
  });

  it("annotates empty this-season compliance honestly", () => {
    const empty = annotateToolOutput(
      "rules.compliance",
      {
        seasonYear: 2027,
        constraintCount: 0,
        openRuleNotes: 0,
        status: "pass",
        findings: [],
      },
      { seasonYear: 2027, proposal: "intake" },
    );
    expect(empty.status).toBe("empty");
    expect(empty.summary).toMatch(/2027|this-season/i);
  });

  it("annotates empty kickoff rules for a season without notes", () => {
    const empty = annotateToolOutput(
      "kickoff.rules",
      { seasonYear: 2027, ruleNotes: [], constraints: [] },
      { seasonYear: 2027 },
    );
    expect(empty.status).toBe("empty");
  });
});
