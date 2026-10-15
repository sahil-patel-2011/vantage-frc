import { describe, expect, it } from "vitest";
import {
  CODE_COACH_SAMPLE,
  groundedCodeCoachProposal,
  isCodeCoachSampleContent,
} from "./code-related";

describe("groundedCodeCoachProposal", () => {
  it("allows the teaching-sample diff only for sample content", () => {
    const sample = groundedCodeCoachProposal({
      path: "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
      content: CODE_COACH_SAMPLE,
    });
    expect(sample?.unifiedDiff).toContain("Timer.delay");
    expect(sample?.unifiedDiff).toContain("MathUtil.clamp");
    expect(isCodeCoachSampleContent(CODE_COACH_SAMPLE)).toBe(true);
  });

  it("refuses to invent a diff for arbitrary source", () => {
    expect(
      groundedCodeCoachProposal({
        path: "Robot.java",
        content: "class Robot { void periodic() { driveMotor.set(0.5); } }",
      }),
    ).toBeNull();
  });

  it("accepts a caller-supplied unified diff", () => {
    const diff = "--- a/Robot.java\n+++ b/Robot.java\n@@ -1 +1 @@\n-old\n+new";
    expect(groundedCodeCoachProposal({ path: "Robot.java", content: "old", unifiedDiff: diff })).toEqual({
      summary: "Proposed safe change",
      unifiedDiff: diff,
    });
  });
});
