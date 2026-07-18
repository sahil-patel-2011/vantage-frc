import { describe, expect, it } from "vitest";
import {
  annotateToolOutput,
  buildEngineeringBriefFromTools,
  createVantageToolRegistry,
  planCadStrategyToolCalls,
  planChatToolCalls,
  SHARED_STRATEGY_CAD_TOOLS,
} from "../src";

describe("cross-feature AI tool graph", () => {
  it("registers strategy, kickoff, FMEA, finance, and CAD brief tools", () => {
    const names = createVantageToolRegistry().list().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "strategy.match",
        "strategy.design",
        "kickoff.intelligence",
        "fmea.open_risks",
        "finance.summary",
        "cad.create_brief",
        "scouting.team",
        "knowledge.search",
      ]),
    );
    expect(SHARED_STRATEGY_CAD_TOOLS).toEqual(
      expect.arrayContaining(["strategy.match", "fmea.open_risks", "cad.create_brief"]),
    );
  });

  it("plans CAD surface tools including kickoff design priorities and FMEA risks", () => {
    const calls = planChatToolCalls("Design a climber within frame perimeter rules", {
      capability: "cad",
      seasonYear: 2027,
    });
    const names = calls.map((call) => call.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "kickoff.intelligence",
        "strategy.design",
        "fmea.open_risks",
        "cad.briefs",
      ]),
    );
  });

  it("lets chat invoke CAD brief creation", () => {
    const calls = planChatToolCalls("Please create a CAD engineering brief for a coral intake", {
      seasonYear: 2027,
    });
    expect(calls.some((call) => call.name === "cad.create_brief")).toBe(true);
  });

  it("strategy surface cites scout validation + TBA reference tools", () => {
    const calls = planChatToolCalls("Strategy for team 254 alliance strengths", {
      capability: "strategy",
      seasonYear: 2027,
    });
    const names = calls.map((call) => call.name);
    expect(names).toEqual(expect.arrayContaining(["scouting.team", "reference.team"]));
  });

  it("annotates TBA scout conflicts on strategy.match", () => {
    const annotated = annotateToolOutput(
      "strategy.match",
      {
        prediction: { pRed: 0.55 },
        strategy: { plan: {} },
        scoutTbaConflicts: [{ fieldKey: "climb", status: "conflict" }],
      },
      { matchKey: "2027nysu_qm1" },
    );
    expect(annotated.summary).toMatch(/TBA-contradicted/);
  });

  it("maps FMEA + kickoff tool facts into an engineering brief", () => {
    const brief = buildEngineeringBriefFromTools({
      request: "Reliable elevator",
      context: [
        {
          type: "module_fact",
          id: "fmea:0",
          importance: 1,
          content: JSON.stringify({
            tool: "fmea.open_risks",
            status: "ok",
            classification: "model_inference",
            summary: "1 open",
            data: {
              failures: [{ subsystemName: "Elevator", title: "Chain skip", rpn: 180 }],
            },
          }),
        },
        {
          type: "module_fact",
          id: "kickoff:0",
          importance: 1,
          content: JSON.stringify({
            tool: "strategy.design",
            status: "ok",
            classification: "model_inference",
            summary: "ok",
            data: {
              priorities: [{ capability: "L4 scoring", rationale: "High points", status: "committed" }],
            },
          }),
        },
      ],
    });
    expect(brief.risks.some((risk) => risk.includes("Elevator"))).toBe(true);
    expect(brief.requirements.some((row) => row.includes("L4"))).toBe(true);
  });

  it("CAD strategy planner prefers shared graph tools", () => {
    const calls = planCadStrategyToolCalls("Engineering brief for scoring mechanism", {
      matchKey: "2027nysu_qm12",
      seasonYear: 2027,
    });
    expect(calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["strategy.match", "kickoff.intelligence", "fmea.open_risks"]),
    );
  });
});
