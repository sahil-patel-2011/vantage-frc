import { describe, expect, it } from "vitest";
import { buildEngineeringBriefFromTools, planCadStrategyToolCalls, planChatToolCalls } from "../src";

function toolFact(tool: string, data: unknown, status: "ok" | "empty" = "ok") {
  return {
    type: "module_fact" as const,
    id: `${tool}:0`,
    importance: 1,
    content: JSON.stringify({
      tool,
      status,
      classification: "model_inference",
      summary: status === "ok" ? "ok" : "empty",
      data,
    }),
  };
}

describe("CAD strategy brief wiring", () => {
  it("plans strategy.match + kickoff summary + rules for CAD capability", () => {
    const calls = planCadStrategyToolCalls("Engineering brief for a scoring mechanism", {
      matchKey: "2026nysu_qm12",
      seasonYear: 2026,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "strategy.match", input: { matchKey: "2026nysu_qm12" } }),
        expect.objectContaining({ name: "kickoff.intelligence" }),
        expect.objectContaining({ name: "strategy.design" }),
        expect.objectContaining({ name: "kickoff.rules" }),
      ]),
    );
  });

  it("auto-tools CAD surface includes strategy.match from selected match", () => {
    const calls = planChatToolCalls("Create an engineering design brief for intake", {
      capability: "cad",
      selected: { matchKey: "2026nysu_qm7" },
      seasonYear: 2026,
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "strategy.match", input: { matchKey: "2026nysu_qm7" } }),
        expect.objectContaining({ name: "kickoff.intelligence" }),
        expect.objectContaining({ name: "kickoff.rules" }),
      ]),
    );
  });

  it("maps strategy + kickoff tools into a CAD design brief", () => {
    const brief = buildEngineeringBriefFromTools({
      request: "Design a reliable coral intake",
      context: [
        toolFact("strategy.match", {
          prediction: { keyFactors: [{ name: "teleop" }], caveats: ["Small sample size"] },
          strategy: { plan: { priorities: ["Protect cycle consistency"], risksToMitigate: ["autonomous"] } },
        }),
        toolFact("kickoff.intelligence", {
          record: {
            summary: {
              scoring: [{ action: "Coral L4", phase: "teleop", points: 5 }],
              constraints: ["Max extension 48 in"],
              openQuestions: ["Can coral be descored?"],
            },
            designPrioritiesDraft: [{ capability: "Coral acquisition" }],
          },
        }),
        toolFact("kickoff.rules", {
          ruleNotes: [
            { question: "Extension limit?", answer: "48 inches outside frame", ruleRef: "R105", status: "answered" },
            { question: "Can coral be descored?", answer: "", ruleRef: "", status: "open" },
          ],
          constraints: [],
        }),
      ],
    });
    expect(brief.summary).toContain("coral intake");
    expect(brief.requirements).toEqual(expect.arrayContaining(["Protect cycle consistency", "Coral acquisition"]));
    expect(brief.scoringTasks.some((task) => task.includes("Coral L4"))).toBe(true);
    expect(brief.constraints.some((row) => row.includes("48"))).toBe(true);
  });
});
