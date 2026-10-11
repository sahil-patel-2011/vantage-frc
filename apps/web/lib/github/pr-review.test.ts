import { describe, expect, it } from "vitest";
import {
  PR_REVIEW_MAX_FILES,
  addedLines,
  parsePrReview,
  prReviewMessage,
  reviewIsStale,
  selectReviewableFiles,
} from "./pr-review";

const PATCH = [
  "@@ -10,6 +10,8 @@ public class Shooter extends SubsystemBase {",
  "   private final TalonFX left = new TalonFX(Constants.kShooterLeftId);",
  "-  private final TalonFX right = new TalonFX(5);",
  "+  private final TalonFX right = new TalonFX(5);",
  "+  private double rpm = 6000 * 2 * Math.PI;",
  "   public Shooter() {",
  "+    right.setInverted(false);",
  "   }",
].join("\n");

const FILES = [{ filename: "src/main/java/frc/robot/subsystems/Shooter.java", status: "modified", patch: PATCH, truncated: false }];

describe("addedLines", () => {
  it("numbers added lines in the new file from the hunk header", () => {
    expect(addedLines(PATCH)).toEqual([
      { line: 11, text: "  private final TalonFX right = new TalonFX(5);" },
      { line: 12, text: "  private double rpm = 6000 * 2 * Math.PI;" },
      { line: 14, text: "    right.setInverted(false);" },
    ]);
  });
});

describe("parsePrReview", () => {
  it("keeps a finding that quotes an added line and gives it the new-file line number", () => {
    const text = JSON.stringify({
      summary: "Adds a shooter RPM target.",
      risk: "low",
      findings: [
        {
          file: "src/main/java/frc/robot/subsystems/Shooter.java",
          severity: "high",
          title: "RPM converted to rad/s by mistake",
          detail: "6000 * 2π is rad/min, not RPM.",
          quote: "private double rpm = 6000 * 2 * Math.PI;",
        },
      ],
    });
    const result = parsePrReview(`Here you go:\n\`\`\`json\n${text}\n\`\`\``, FILES);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ line: 12, severity: "high" });
    // A high-severity finding outranks the model's own "low".
    expect(result.risk).toBe("high");
    expect(result.droppedUngrounded).toBe(0);
  });

  it("drops findings that quote removed lines, other files or invented code", () => {
    const text = JSON.stringify({
      summary: "s",
      risk: "medium",
      findings: [
        { file: FILES[0]!.filename, severity: "low", title: "Unchanged line", quote: "private final TalonFX left = new TalonFX(Constants.kShooterLeftId);" },
        { file: "src/Other.java", severity: "high", title: "Wrong file", quote: "right.setInverted(false);" },
        { file: FILES[0]!.filename, severity: "high", title: "Made up", quote: "motor.set(1.0); // full speed forever" },
        { file: FILES[0]!.filename, severity: "medium", title: "Inversion", quote: "right.setInverted(false);" },
      ],
    });
    const result = parsePrReview(text, FILES);
    expect(result.findings.map((f) => f.title)).toEqual(["Inversion"]);
    expect(result.droppedUngrounded).toBe(3);
    expect(result.risk).toBe("medium");
  });

  it("refuses output that is not JSON", () => {
    expect(() => parsePrReview("Looks good to me!", FILES)).toThrow(/expected format/);
  });
});

describe("selectReviewableFiles", () => {
  it("puts robot source first and skips removed, generated, binary and lock files", () => {
    const { reviewed, skipped } = selectReviewableFiles([
      { filename: "README.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" },
      { filename: "src/main/java/Robot.java", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+y" },
      { filename: "build/libs/robot.jar", status: "added", additions: 0, deletions: 0, patch: null },
      { filename: "src/main/deploy/logo.png", status: "added", additions: 0, deletions: 0, patch: null },
      { filename: "src/Old.java", status: "removed", additions: 0, deletions: 9, patch: "@@" },
      { filename: "package-lock.json", status: "modified", additions: 9, deletions: 9, patch: "@@" },
    ]);
    expect(reviewed.map((f) => f.filename)).toEqual(["src/main/java/Robot.java", "README.md"]);
    expect(Object.fromEntries(skipped.map((s) => [s.filename, s.reason]))).toEqual({
      "build/libs/robot.jar": "generated",
      "src/main/deploy/logo.png": "not_code",
      "src/Old.java": "removed",
      "package-lock.json": "generated",
    });
  });

  it(`reviews at most ${PR_REVIEW_MAX_FILES} files`, () => {
    const many = Array.from({ length: PR_REVIEW_MAX_FILES + 5 }, (_, i) => ({
      filename: `src/F${i}.java`,
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@\n+z",
    }));
    const { reviewed, skipped } = selectReviewableFiles(many);
    expect(reviewed).toHaveLength(PR_REVIEW_MAX_FILES);
    expect(skipped.filter((s) => s.reason === "over_limit")).toHaveLength(5);
  });
});

describe("prReviewMessage", () => {
  it("asks for grounded JSON and names what was left out", () => {
    const message = prReviewMessage({
      repoFullName: "team6925/robot",
      pull: { number: 7, title: "Shooter RPM", authorLogin: "riley", baseRef: "main", headRef: "shooter" },
      files: FILES,
      skipped: [{ filename: "logo.png", reason: "not_code" }],
      codeMap: "[Robot code] team6925/robot@main",
    });
    expect(message).toMatch(/#7 "Shooter RPM"/);
    expect(message).toMatch(/JSON only/);
    expect(message).toMatch(/quote/);
    expect(message).toMatch(/logo\.png \(not_code\)/);
    expect(message).toMatch(/\[Robot code\]/);
  });
});

describe("reviewIsStale", () => {
  it("treats a review still running after five minutes as stopped", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(reviewIsStale("running", "2026-10-11T11:54:00Z", now)).toBe(true);
    expect(reviewIsStale("running", "2026-10-11T11:58:00Z", now)).toBe(false);
    expect(reviewIsStale("done", "2026-10-11T10:00:00Z", now)).toBe(false);
  });
});
