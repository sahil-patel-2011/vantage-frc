import { describe, expect, it } from "vitest";
import { buildDiffProposal, reviewFrcCode } from "../src";

describe("FRC coding assistant", () => {
  it("flags robot-loop and hardware-map risks with file evidence", () => {
    const review = reviewFrcCode({
      path: "src/main/java/frc/robot/Robot.java",
      content: "void robotPeriodic() { Thread.sleep(100); new TalonFX(3); setSupplyCurrentLimit(40); }",
    });
    expect(review.riskLevel).toBe("high");
    expect(review.risks.map(({ pattern }) => pattern)).toEqual([
      "blocking-robot-loop",
      "hardcoded-can-id",
    ]);
    expect(review.artifact.claimProvenance[0]?.sourceIds).toEqual([
      "file:src/main/java/frc/robot/Robot.java",
    ]);
  });

  it("flags motor construction without a supply current limit in the same source", () => {
    const missing = reviewFrcCode({
      path: "Drive.java",
      content: "new SparkMax(1, MotorType.kBrushless);",
    });
    expect(missing.risks.map((risk) => risk.pattern)).toContain("missing-supply-current-limit");
    expect(missing.risks.find((risk) => risk.pattern === "missing-supply-current-limit")?.message.toLowerCase()).not.toContain(
      "demo",
    );
    const limited = reviewFrcCode({
      path: "Drive.java",
      content: "new SparkMax(1, MotorType.kBrushless);\nsetSmartCurrentLimit(40);",
    });
    expect(limited.risks.some((risk) => risk.pattern === "missing-supply-current-limit")).toBe(false);
    const idle = reviewFrcCode({ path: "Robot.java", content: "class Robot {}" });
    expect(idle.risks.some((risk) => risk.pattern === "missing-supply-current-limit")).toBe(false);
  });

  it("keeps generated changes approval-gated", () => {
    const review = reviewFrcCode({ path: "Robot.java", content: "class Robot {}" });
    const proposal = buildDiffProposal({
      path: "Robot.java",
      summary: "Add safe command",
      unifiedDiff: "--- a/Robot.java\n+++ b/Robot.java\n@@ -1 +1 @@\n-class Robot {}\n+class Robot { }",
      review,
    });
    expect(proposal).toMatchObject({
      requiresHumanApproval: true,
      executionState: "proposal_only",
    });
  });
});
