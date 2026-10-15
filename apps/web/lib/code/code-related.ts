/** Known teaching sample — proposals may use the grounded sample diff only for this content. */
export const CODE_COACH_SAMPLE = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

/** Grounded unified diff for CODE_COACH_SAMPLE only — never invent diffs for other source. */
export const CODE_COACH_SAMPLE_DIFF = [
  `--- a/src/main/java/frc/robot/subsystems/DriveSubsystem.java`,
  `+++ b/src/main/java/frc/robot/subsystems/DriveSubsystem.java`,
  "@@ -1,4 +1,4 @@",
  " public void periodic() {",
  "- Timer.delay(0.02);",
  "- driveMotor.set(3);",
  "+ driveMotor.set(MathUtil.clamp(demand, -1.0, 1.0));",
  " }",
].join("\n");

/**
 * True when source still matches the teaching sample (normalize newlines).
 * Sample proposals are only allowed for this content — never invent diffs elsewhere.
 */
export function isCodeCoachSampleContent(content: string): boolean {
  return content.replace(/\r\n/g, "\n").trim() === CODE_COACH_SAMPLE.trim();
}

/**
 * Build a proposal payload only when grounded — sample teaching diff or caller-supplied unifiedDiff.
 * Returns null when inventing a fix would be required.
 */
export function groundedCodeCoachProposal(input: {
  path: string;
  content: string;
  unifiedDiff?: string;
}): { summary: string; unifiedDiff: string } | null {
  const supplied = input.unifiedDiff?.trim() ?? "";
  if (supplied.startsWith("--- ") && supplied.includes("\n+++ ")) {
    return { summary: "Proposed safe change", unifiedDiff: supplied };
  }
  if (isCodeCoachSampleContent(input.content)) {
    return {
      summary: "Clamp motor output and remove blocking sleep",
      unifiedDiff: CODE_COACH_SAMPLE_DIFF.replaceAll(
        "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
        input.path || "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
      ),
    };
  }
  return null;
}
