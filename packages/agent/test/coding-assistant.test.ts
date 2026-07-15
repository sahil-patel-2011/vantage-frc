import { describe, expect, it } from "vitest";
import { buildDiffProposal, reviewFrcCode } from "../src";

describe("FRC coding assistant", () => {
  it("flags robot-loop and hardware-map risks with file evidence", () => {
    const review = reviewFrcCode({
      path: "src/main/java/frc/robot/Robot.java",
      content: "void robotPeriodic() { Thread.sleep(100); new TalonFX(3); }",
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
