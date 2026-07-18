import { describe, expect, it } from "vitest";
import { checkGameRuleCompliance } from "../src/rule-compliance";
import { annotateToolOutput, planChatToolCalls } from "../src/auto-tools";
import { buildEngineeringBriefFromTools } from "../src/brief-from-tools";

describe("checkGameRuleCompliance", () => {
  it("flags proposals that touch hard extension constraints", () => {
    const report = checkGameRuleCompliance({
      proposal: "Intake extends 60 inches outside the frame perimeter for ground pickup.",
      constraints: ["Robots may not extend beyond 48 inches outside the frame perimeter"],
    });
    expect(report.status).toBe("fail");
    expect(report.findings.some((f) => f.severity === "block")).toBe(true);
  });

  it("surfaces open rule questions that overlap the proposal", () => {
    const report = checkGameRuleCompliance({
      proposal: "Add a Coral descoring claw for teleop defense.",
      ruleNotes: [{ question: "Can Coral be descored by opponents in teleop?", status: "open", ruleRef: "G420" }],
    });
    expect(report.status).toBe("warn");
    expect(report.findings[0]?.ruleRef).toBe("G420");
  });
});

describe("shared strategy/CAD tool planner", () => {
  it("selects kickoff + compliance + design tools for CAD capability", () => {
    const calls = planChatToolCalls("Design a climber within frame perimeter rules", {
      capability: "cad",
      seasonYear: 2027,
    });
    const names = calls.map((call) => call.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "kickoff.intelligence",
        "strategy.design",
        "kickoff.rules",
        "rules.compliance",
      ]),
    );
  });

  it("annotates empty kickoff intelligence honestly", () => {
    const empty = annotateToolOutput("kickoff.intelligence", { seasonYear: 2027, record: null }, { seasonYear: 2027 });
    expect(empty.status).toBe("empty");
  });

  it("builds a CAD brief from kickoff + compliance tool facts", () => {
    const brief = buildEngineeringBriefFromTools({
      request: "Design a Coral intake within the extension limit",
      context: [
        {
          type: "module_fact",
          id: "kickoff.intelligence:0",
          content: JSON.stringify({
            tool: "kickoff.intelligence",
            status: "ok",
            classification: "researched_claim",
            data: {
              record: {
                summary: {
                  scoring: [{ action: "Coral L4", phase: "teleop", points: 5 }],
                  constraints: ["Robots may not extend beyond 48 inches outside the frame perimeter"],
                  openQuestions: ["Can Coral be descored by opponents in teleop?"],
                },
                designPrioritiesDraft: [{ capability: "Coral acquisition / handling" }],
              },
            },
          }),
          importance: 1,
        },
        {
          type: "module_fact",
          id: "rules.compliance:1",
          content: JSON.stringify({
            tool: "rules.compliance",
            status: "ok",
            classification: "model_inference",
            data: { status: "warn", findings: [{ message: "Proposal may touch extension constraint" }] },
          }),
          importance: 1,
        },
      ],
    });
    expect(brief.requirements.some((row) => /Coral/i.test(row))).toBe(true);
    expect(brief.constraints.some((row) => /48 inches|compliance/i.test(row))).toBe(true);
  });
});
