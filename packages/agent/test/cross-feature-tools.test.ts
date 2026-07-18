import { describe, expect, it } from "vitest";
import {
  annotateToolOutput,
  buildEngineeringBriefFromTools,
  createVantageToolRegistry,
  CROSS_FEATURE_TOOL_GRAPH,
  ORG_DATA_TOOLS,
  planCadStrategyToolCalls,
  planChatToolCalls,
  SHARED_STRATEGY_CAD_TOOLS,
  toolUsesOrgData,
} from "../src";

describe("cross-feature AI tool graph", () => {
  it("registers the full shared engine surface", () => {
    const names = createVantageToolRegistry().list().map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "strategy.match",
        "strategy.design",
        "kickoff.intelligence",
        "kickoff.rules",
        "fmea.open_risks",
        "fmea.repeat",
        "finance.summary",
        "finance.orders",
        "finance.create_purchase_request",
        "cad.create_brief",
        "cad.design_context",
        "inventory.availability",
        "scouting.team",
        "knowledge.search",
        "knowledge.get_page",
        "my_day.summary",
        "calendar.upcoming",
        "rules.compliance",
      ]),
    );
    expect(SHARED_STRATEGY_CAD_TOOLS).toEqual(
      expect.arrayContaining([
        "strategy.match",
        "fmea.open_risks",
        "cad.create_brief",
        "knowledge.get_page",
        "my_day.summary",
        "scouting.team",
      ]),
    );
    expect(ORG_DATA_TOOLS).toEqual(
      expect.arrayContaining(["fmea.open_risks", "my_day.summary", "cad.create_brief", "calendar.upcoming"]),
    );
    expect(toolUsesOrgData("fmea.open_risks")).toBe(true);
    expect(toolUsesOrgData("my_day.summary")).toBe(true);
    expect(toolUsesOrgData("reference.team")).toBe(false);
  });

  it("documents what each surface can call", () => {
    expect(CROSS_FEATURE_TOOL_GRAPH.chat).toEqual(
      expect.arrayContaining(["cad.create_brief", "finance.summary", "my_day.summary", "scouting.team"]),
    );
    expect(CROSS_FEATURE_TOOL_GRAPH.cad).toEqual(
      expect.arrayContaining([
        "strategy.match",
        "kickoff.intelligence",
        "fmea.open_risks",
        "scouting.team",
        "knowledge.search",
        "finance.create_purchase_request",
      ]),
    );
    expect(CROSS_FEATURE_TOOL_GRAPH.strategy).toEqual(
      expect.arrayContaining(["cad.design_context", "scouting.team", "my_day.summary", "knowledge.search"]),
    );
    expect(CROSS_FEATURE_TOOL_GRAPH.cad_brief).toEqual(
      expect.arrayContaining(["strategy.match", "scouting.team", "fmea.open_risks", "knowledge.search"]),
    );
    expect(CROSS_FEATURE_TOOL_GRAPH.context_links["strategy_match→cad_job"]).toBe("informs");
    expect(CROSS_FEATURE_TOOL_GRAPH.context_links["fmea_failure→cad_job"]).toBe("blocks");
    expect(CROSS_FEATURE_TOOL_GRAPH.context_links["scout_entry→cad_job"]).toBe("validates");
  });

  it("plans CAD surface tools including kickoff, FMEA, knowledge, and inventory", () => {
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
        "inventory.availability",
        "knowledge.search",
      ]),
    );
  });

  it("CAD surface pulls trusted scouting when a team is selected", () => {
    const calls = planChatToolCalls("Design intake for alliance partner", {
      capability: "cad",
      selected: { teamKey: "frc254" },
      seasonYear: 2027,
    });
    expect(calls).toEqual(
      expect.arrayContaining([{ name: "scouting.team", input: { teamKey: "frc254" } }]),
    );
  });

  it("lets chat invoke CAD brief creation and finance-gated purchase tools", () => {
    const briefCalls = planChatToolCalls("Please create a CAD engineering brief for a coral intake", {
      seasonYear: 2027,
    });
    expect(briefCalls.some((call) => call.name === "cad.create_brief")).toBe(true);

    const financeCalls = planChatToolCalls("What is our remaining season budget and open purchase requests?", {
      seasonYear: 2027,
    });
    const financeNames = financeCalls.map((call) => call.name);
    expect(financeNames).toEqual(expect.arrayContaining(["finance.summary", "finance.orders"]));
  });

  it("chat planner auto-invokes My Day for competition cues", () => {
    const calls = planChatToolCalls("What's next on my day — bumpers for the next match?", {
      seasonYear: 2027,
    });
    expect(calls.some((call) => call.name === "my_day.summary")).toBe(true);
  });

  it("strategy surface cites scout validation, CAD design context, knowledge, and FMEA", () => {
    const calls = planChatToolCalls("Strategy for team 254 alliance strengths at competition", {
      capability: "strategy",
      seasonYear: 2027,
    });
    const names = calls.map((call) => call.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "scouting.team",
        "reference.team",
        "cad.design_context",
        "knowledge.search",
        "fmea.open_risks",
        "my_day.summary",
      ]),
    );
  });

  it("addresses CAD feedback to the selected strategy match", () => {
    const calls = planChatToolCalls("Build the match strategy", {
      capability: "strategy",
      selected: { matchKey: "2027nysu_qm18" },
      seasonYear: 2027,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        { name: "cad.design_context", input: { matchKey: "2027nysu_qm18", limit: 6 } },
        { name: "strategy.match", input: { matchKey: "2027nysu_qm18" } },
      ]),
    );
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

  it("maps FMEA + kickoff + trusted scouting into an engineering brief", () => {
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
        {
          type: "module_fact",
          id: "scout:0",
          importance: 1,
          content: JSON.stringify({
            tool: "scouting.team",
            status: "ok",
            classification: "scout_observation",
            summary: "trusted",
            data: [
              {
                teamKey: "frc254",
                conflictCount: 1,
                excludedFields: ["climb"],
                trustedPayload: { autoCoral: 3, teleopCycles: 8 },
              },
            ],
          }),
        },
      ],
    });
    expect(brief.risks.some((risk) => risk.includes("Elevator"))).toBe(true);
    expect(brief.requirements.some((row) => row.includes("L4"))).toBe(true);
    expect(brief.risks.some((risk) => risk.includes("do not trust climb"))).toBe(true);
    expect(brief.constraints.some((row) => row.includes("Trusted scout"))).toBe(true);
  });

  it("turns real inventory and BOM stock into CAD constraints and sourcing risks", () => {
    const brief = buildEngineeringBriefFromTools({
      request: "Build an intake",
      context: [
        {
          type: "module_fact",
          id: "inventory:0",
          importance: 1,
          content: JSON.stringify({
            tool: "inventory.availability",
            status: "ok",
            classification: "hard_metric",
            summary: "stock",
            data: {
              items: [{ name: "2x1 tube", quantity: "6", unit: "ft", locationName: "Rack A" }],
              bom: [{ name: "NEO motor", shortage: "1" }],
            },
          }),
        },
      ],
    });
    expect(brief.constraints).toContain("Inventory: 6 ft 2x1 tube available at Rack A");
    expect(brief.risks).toContain("BOM shortage: 1 NEO motor must be sourced before build");
  });

  it("CAD strategy planner prefers shared graph tools including trusted scouting", () => {
    const calls = planCadStrategyToolCalls("Engineering brief for scoring mechanism", {
      matchKey: "2027nysu_qm12",
      teamKey: "frc1678",
      seasonYear: 2027,
    });
    expect(calls.map((call) => call.name)).toEqual(
      expect.arrayContaining(["strategy.match", "kickoff.intelligence", "fmea.open_risks", "scouting.team"]),
    );
    expect(calls).toEqual(
      expect.arrayContaining([{ name: "scouting.team", input: { teamKey: "frc1678" } }]),
    );
  });
});
