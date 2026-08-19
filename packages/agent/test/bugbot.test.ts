import { describe, expect, it } from "vitest";
import { groundBugbotFindings, mergeBugbotReview } from "../src/bugbot";

const SOURCE = `public void periodic() {
  Timer.delay(0.02);
  new TalonFX(4);
}
`;

describe("AI Bugbot grounding", () => {
  it("drops model findings whose evidence is not in the source", () => {
    const grounded = groundBugbotFindings({
      path: "Drive.java",
      content: SOURCE,
      modelText: JSON.stringify({
        findings: [
          { severity: "high", finding: "Blocking loop starves scheduler", evidence: "Timer.delay(0.02)" },
          { severity: "high", finding: "Invented brownout", evidence: "setVoltage(99)" },
        ],
      }),
    });
    expect(grounded.findings).toHaveLength(1);
    expect(grounded.findings[0]?.location).toBe("Drive.java:2");
    expect(grounded.droppedUngrounded).toBe(1);
  });

  it("merges local pattern hits with grounded model findings", () => {
    const review = mergeBugbotReview({
      path: "Drive.java",
      content: SOURCE,
      modelText: '{"findings":[{"severity":"medium","finding":"Hard-coded CAN id","evidence":"new TalonFX(4)"}]}',
    });
    expect(review.localRiskCount).toBeGreaterThan(0);
    expect(review.modelFindingCount).toBe(1);
    expect(review.findings.some((item) => item.source === "local_rule")).toBe(true);
    expect(review.findings.some((item) => item.source === "model" && item.evidence.includes("TalonFX"))).toBe(true);
    expect(review.riskLevel).toBe("high");
  });

  it("stays empty of model findings when the planner returns prose", () => {
    const review = mergeBugbotReview({
      path: "Robot.java",
      content: "class Robot {}",
      modelText: "Looks fine to me.",
    });
    expect(review.modelFindingCount).toBe(0);
    expect(review.findings.every((item) => item.source === "local_rule")).toBe(true);
  });
});
