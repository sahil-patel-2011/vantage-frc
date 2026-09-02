import { describe, expect, it } from "vitest";
import {
  applyBugbotDismissals,
  BUGBOT_PROMPT_MAX_CHARS,
  BUGBOT_RULE_MAX_HITS,
  BUGBOT_SCAN_MAX_CHARS,
  bugbotBundleSections,
  bugbotFindingFingerprint,
  bugbotFixUserMessage,
  bugbotPromptSlice,
  bugbotScanCostUsd,
  bugbotScopeKey,
  bugbotUserMessage,
  classifyBugbotPath,
  diffBugbotFindings,
  formatBugbotScanBundle,
  frcBugbotFindings,
  locateBugbotLine,
  mergeBugbotReview,
  planBugbotScan,
  type BugbotTreeEntry,
} from "../src/bugbot";

/** A tree shaped like a real WPILib Java project: mostly not robot code. */
function wpilibTree(): BugbotTreeEntry[] {
  const noise: BugbotTreeEntry[] = [];
  for (let index = 0; index < 220; index += 1) {
    noise.push({ path: `build/classes/java/main/frc/robot/Gen${index}.class`, type: "blob", size: 900 });
  }
  for (let index = 0; index < 30; index += 1) {
    noise.push({ path: `vendordeps/Vendor${index}.json`, type: "blob", size: 4000 });
  }
  const source: BugbotTreeEntry[] = [
    { path: "src/main/java/frc/robot/Robot.java", type: "blob", size: 4000 },
    { path: "src/main/java/frc/robot/RobotContainer.java", type: "blob", size: 6000 },
    { path: "src/main/java/frc/robot/Constants.java", type: "blob", size: 3000 },
    { path: "src/main/java/frc/robot/subsystems/Drive.java", type: "blob", size: 9000 },
    { path: "src/main/java/frc/robot/subsystems/Arm.java", type: "blob", size: 7000 },
    { path: "src/main/java/frc/robot/commands/Score.java", type: "blob", size: 2500 },
    { path: "src/test/java/frc/robot/DriveTest.java", type: "blob", size: 1500 },
    { path: "src/main/java/frc/robot/generated/TunerConstants.java", type: "blob", size: 12_000 },
    { path: "gradle/wrapper/gradle-wrapper.properties", type: "blob", size: 200 },
    { path: "README.md", type: "blob", size: 900 },
    { path: "src/main/java/frc/robot/util/Huge.java", type: "blob", size: 400_000 },
  ];
  return [...noise, ...source];
}

describe("Bugbot scan planning", () => {
  it("names a skip reason for every file it will not read", () => {
    expect(classifyBugbotPath("vendordeps/Phoenix6.json")).toMatchObject({
      include: false,
      reason: "vendor_dependency",
    });
    expect(classifyBugbotPath("build/classes/Robot.class")).toMatchObject({ reason: "build_output" });
    expect(classifyBugbotPath("src/main/java/frc/robot/generated/TunerConstants.java")).toMatchObject({
      reason: "generated_code",
    });
    expect(classifyBugbotPath("src/test/java/frc/robot/DriveTest.java")).toMatchObject({
      reason: "test_source",
    });
    expect(classifyBugbotPath("README.md")).toMatchObject({ reason: "not_robot_code" });
    expect(classifyBugbotPath("src/main/java/frc/robot/Big.java", 400_000)).toMatchObject({
      reason: "file_too_large",
    });
    expect(classifyBugbotPath("src/main/java/frc/robot/Robot.java", 4000)).toMatchObject({
      include: true,
      role: "entry_point",
    });
  });

  it("puts robot entry points in the first chunk and reports the whole skip list", () => {
    const plan = planBugbotScan(wpilibTree(), { chunkFiles: 3, maxChunks: 2 });
    expect(plan.chunks[0]?.[0]).toBe("src/main/java/frc/robot/Robot.java");
    expect(plan.chunks[0]).toContain("src/main/java/frc/robot/RobotContainer.java");
    expect(plan.chunkCount).toBe(2);
    // Six readable robot-code files, six planned across two chunks of three.
    expect(plan.candidateCount).toBe(6);
    expect(plan.reviewed).toHaveLength(6);
    const reasons = Object.fromEntries(plan.skipCounts.map((item) => [item.reason, item.count]));
    expect(reasons.build_output).toBe(220);
    expect(reasons.vendor_dependency).toBe(30);
    expect(reasons.generated_code).toBe(1);
    expect(reasons.test_source).toBe(1);
    expect(reasons.file_too_large).toBe(1);
    expect(plan.skipCounts.every((item) => item.label.length > 0)).toBe(true);
  });

  it("defers files past the chunk budget instead of silently dropping them", () => {
    const plan = planBugbotScan(wpilibTree(), { chunkFiles: 2, maxChunks: 2 });
    expect(plan.reviewed).toHaveLength(4);
    expect(plan.deferredCount).toBe(2);
    expect(plan.skipped.some((item) => item.reason === "beyond_scan_budget")).toBe(true);
  });

  it("prices a chunked scan before the button is pressed", () => {
    expect(bugbotScanCostUsd({ chunkCount: 3, tier: "ultra" })).toEqual({
      perChunkUsd: 1,
      totalUsd: 3,
      chunkCount: 3,
    });
    expect(bugbotScanCostUsd({ chunkCount: 3, tier: "subscription" }).totalUsd).toBe(0);
  });

  it("tells the model exactly which files the chunk covers", () => {
    const message = bugbotUserMessage({
      path: "github-scan",
      content: "class Robot {}",
      localRisks: [],
      reviewedFiles: ["src/main/java/frc/robot/Robot.java"],
      chunkLabel: "team/robot chunk 2 of 4",
    });
    expect(message).toContain("Chunk: team/robot chunk 2 of 4");
    expect(message).toContain("src/main/java/frc/robot/Robot.java");
    expect(message).toContain("Do not comment on files that are not in this chunk");
    expect(message).toContain("rotations vs radians vs degrees");
  });
});

const CAN_CONFLICT = `public class Drive {
  private final TalonFX left = new TalonFX(3);
  private final TalonFX right = new TalonFX(3);
}
`;

describe("FRC failure-class rules", () => {
  it("flags a duplicate CAN id on the same device class", () => {
    const findings = frcBugbotFindings({ path: "Drive.java", content: CAN_CONFLICT });
    const hit = findings.find((item) => item.pattern === "can-id-collision");
    expect(hit?.severity).toBe("high");
    expect(hit?.line).toBe(3);
    expect(CAN_CONFLICT).toContain(hit!.evidence.replace(/^Drive\.java:\d+: /, ""));
  });

  it("flags rotations passed into a radian API and inches into metre geometry", () => {
    const findings = frcBugbotFindings({
      path: "Odo.java",
      content: [
        "var heading = new Rotation2d(encoder.getPosition());",
        "var target = new Translation2d(armInches, 0);",
        "resetPose(heading);",
      ].join("\n"),
    });
    const patterns = findings.map((item) => item.pattern);
    expect(patterns).toContain("units-rotations-as-radians");
    expect(patterns).toContain("units-inches-as-metres");
  });

  it("flags blocking work and default-command registration inside a periodic body", () => {
    const findings = frcBugbotFindings({
      path: "Robot.java",
      content: [
        "public void teleopPeriodic() {",
        "  while (true) { io.update(); }",
        "  System.out.println(\"loop\");",
        "}",
      ].join("\n"),
    });
    const patterns = findings.map((item) => item.pattern);
    expect(patterns).toContain("blocking-call-in-loop");
    expect(patterns).toContain("loop-overrun-print");
  });

  it("flags two commands off one subsystem inside a parallel composition", () => {
    const content = [
      "public Command score() {",
      "  return Commands.parallel(arm.raise(), arm.extend(), intake.spin());",
      "}",
    ].join("\n");
    const findings = frcBugbotFindings({ path: "RobotContainer.java", content });
    const hit = findings.find((item) => item.pattern === "parallel-requires-same-subsystem");
    expect(hit?.severity).toBe("high");
    // The quote has to be real text from the file, like every other finding.
    const quoted = hit!.evidence.replace(/^RobotContainer\.java:\d+: /, "");
    expect(content.replace(/\s+/g, " ")).toContain(quoted);
  });

  it("stays quiet when a parallel composition uses distinct subsystems", () => {
    const findings = frcBugbotFindings({
      path: "RobotContainer.java",
      content: "return Commands.parallel(arm.raise(), intake.spin(), Commands.waitSeconds(0.5));",
    });
    expect(findings.some((item) => item.pattern === "parallel-requires-same-subsystem")).toBe(false);
  });

  it("flags the DriverStation alliance Optional.get crash", () => {
    const findings = frcBugbotFindings({
      path: "Auto.java",
      content: "if (DriverStation.getAlliance().get() == Alliance.Red) { mirror(); }",
    });
    expect(findings.some((item) => item.pattern === "alliance-optional-get")).toBe(true);
  });

  it("stays quiet when the safe pattern is present", () => {
    const safe = [
      "var config = new CurrentLimitsConfigs().withSupplyCurrentLimit(40);",
      "var odometry = new SwerveDriveOdometry(kinematics, gyro.getRotation2d(), positions);",
      "public void resetPose(Pose2d pose) { odometry.resetPosition(gyro.getRotation2d(), positions, pose); }",
      "gyro.reset();",
      "motor.setVoltage(MathUtil.clamp(controller.calculate(measure), -6, 6));",
    ].join("\n");
    const patterns = frcBugbotFindings({ path: "Drive.java", content: safe }).map((item) => item.pattern);
    expect(patterns).not.toContain("odometry-never-reset");
    expect(patterns).not.toContain("gyro-never-zeroed");
    expect(patterns).not.toContain("pid-output-unclamped");
    expect(patterns).not.toContain("current-limit-too-high");
  });

  it("only ever quotes text that is in the file", () => {
    const content = CAN_CONFLICT;
    for (const finding of frcBugbotFindings({ path: "Drive.java", content })) {
      const quoted = finding.evidence.replace(/^Drive\.java:\d+: /, "");
      expect(content.replace(/\s+/g, " ")).toContain(quoted);
    }
  });
});

describe("FRC rule hit caps", () => {
  it("reports every duplicate CAN id — twelve collisions are twelve findings", () => {
    const lines = Array.from({ length: 14 }, (_, index) => `  private final TalonFX m${index} = new TalonFX(7);`);
    const content = `public class Drive {\n${lines.join("\n")}\n}\n`;
    const dupes = frcBugbotFindings({ path: "Drive.java", content }).filter(
      (item) => item.pattern === "can-id-collision",
    );
    // 13 duplicates of the first constructor, capped at the per-rule ceiling.
    expect(dupes).toHaveLength(BUGBOT_RULE_MAX_HITS);
    expect(new Set(dupes.map((item) => item.line)).size).toBe(BUGBOT_RULE_MAX_HITS);
    expect(dupes[0]?.line).toBe(3);
    expect(dupes[BUGBOT_RULE_MAX_HITS - 1]?.line).toBe(2 + BUGBOT_RULE_MAX_HITS);
  });

  it("reports every alliance Optional.get, not just the first", () => {
    const content = [
      "if (DriverStation.getAlliance().get() == Alliance.Red) { a(); }",
      "if (DriverStation.getAlliance().get() == Alliance.Blue) { b(); }",
      "var c = DriverStation.getAlliance().get();",
    ].join("\n");
    const hits = frcBugbotFindings({ path: "Auto.java", content }).filter(
      (item) => item.pattern === "alliance-optional-get",
    );
    expect(hits.map((item) => item.line)).toEqual([1, 2, 3]);
  });

  it("reports blocking calls in every periodic body, not only the first method", () => {
    const content = [
      "public void teleopPeriodic() {",
      "  Thread.sleep(20);",
      "}",
      "public void autonomousPeriodic() {",
      "  Timer.delay(0.02);",
      "  while (true) { io.update(); }",
      "}",
      "public void robotInit() {",
      "  Thread.sleep(500);",
      "}",
    ].join("\n");
    const hits = frcBugbotFindings({ path: "Robot.java", content }).filter(
      (item) => item.pattern === "blocking-call-in-loop",
    );
    // Two bodies, three hits; robotInit is not a 20 ms body.
    expect(hits.map((item) => item.line)).toEqual([2, 5, 6]);
  });

  it("reports every over-limit current setting", () => {
    const content = "a.setSmartCurrentLimit(80);\nb.setSmartCurrentLimit(40);\nc.withSupplyCurrentLimit(90);";
    const hits = frcBugbotFindings({ path: "Drive.java", content }).filter(
      (item) => item.pattern === "current-limit-too-high",
    );
    expect(hits.map((item) => item.line)).toEqual([1, 3]);
  });
});

describe("truncation honesty", () => {
  it("shows the model the whole bundle budget, not a smaller silent slice", () => {
    expect(BUGBOT_PROMPT_MAX_CHARS).toBe(BUGBOT_SCAN_MAX_CHARS);
    const body = `${"x".repeat(30_000)}\nSENTINEL_LATE_IN_FILE\n`;
    const message = bugbotUserMessage({ path: "Drive.java", content: body, localRisks: [] });
    // 30k chars is past the old 24k slice and inside the bundle budget.
    expect(message).toContain("SENTINEL_LATE_IN_FILE");
    expect(message).not.toContain("cut at a read cap");
    expect(bugbotPromptSlice(body).truncated).toBe(false);
  });

  it("names a pasted buffer as cut when it exceeds the prompt budget", () => {
    const body = `${"y".repeat(BUGBOT_PROMPT_MAX_CHARS + 500)}\nSENTINEL_PAST_CAP\n`;
    const sliced = bugbotPromptSlice(body);
    expect(sliced.truncated).toBe(true);
    expect(sliced.text).toHaveLength(BUGBOT_PROMPT_MAX_CHARS);
    const message = bugbotUserMessage({ path: "Huge.java", content: body, localRisks: [] });
    expect(message).not.toContain("SENTINEL_PAST_CAP");
    expect(message).toContain("Files cut at a read cap");
    expect(message).toContain("- Huge.java");
    const fix = bugbotFixUserMessage({ path: "Huge.java", content: body, findings: [], targetFile: "Huge.java" });
    expect(fix).toContain("cut at the read cap");
    expect(fix).toContain("Change ONLY Huge.java");
  });

  it("reports which files were cut and which never made it into the bundle", () => {
    const bundle = formatBugbotScanBundle(
      [
        { path: "A.java", content: "a".repeat(300) },
        { path: "B.java", content: "b".repeat(900) },
        { path: "C.java", content: "c".repeat(300) },
      ],
      1000,
    );
    // A fits whole, B is sliced to what is left, C does not fit at all.
    expect(bundle.included).toEqual(["A.java", "B.java"]);
    expect(bundle.truncatedFiles).toEqual(["B.java"]);
    expect(bundle.omitted).toEqual(["C.java"]);
    expect(bundle.truncated).toBe(true);
    expect(bundle.filesScanned).toBe(2);
    expect(bundle.content.length).toBeLessThanOrEqual(1000);
    expect(bundle.content).not.toContain("C.java");
  });

  it("carries a per-file cut from the fetcher even when the bundle has room", () => {
    const bundle = formatBugbotScanBundle([
      { path: "Robot.java", content: "class Robot {}" },
      { path: "Big.java", content: "class Big {}", truncated: true },
    ]);
    expect(bundle.truncated).toBe(true);
    expect(bundle.truncatedFiles).toEqual(["Big.java"]);
    expect(bundle.included).toEqual(["Robot.java", "Big.java"]);
    expect(bundle.omitted).toEqual([]);
  });

  it("stays honest when nothing was cut", () => {
    const bundle = formatBugbotScanBundle([{ path: "Robot.java", content: "class Robot {}" }]);
    expect(bundle).toMatchObject({ truncated: false, truncatedFiles: [], omitted: [], included: ["Robot.java"] });
  });

  it("tells the model which files were cut so it never reasons about their tails", () => {
    const message = bugbotUserMessage({
      path: "github-scan",
      content: "class Robot {}",
      localRisks: [],
      reviewedFiles: ["src/Robot.java", "src/Drive.java"],
      truncatedFiles: ["src/Drive.java"],
    });
    expect(message).toContain("Files cut at a read cap");
    expect(message).toContain("- src/Drive.java");
    expect(message).toContain("PRIORITISE findings that explain or contradict a known FMEA failure");
  });
});

const BUNDLE = [
  "===== FILE: src/main/java/frc/robot/Robot.java =====",
  "public class Robot {",
  "  public void teleopPeriodic() { Thread.sleep(20); }",
  "}",
  "===== FILE: src/main/java/frc/robot/subsystems/Arm.java =====",
  "public class Arm {",
  "  private final TalonFX motor = new TalonFX(9);",
  "}",
].join("\n");

describe("bundle mapping and finding identity", () => {
  it("maps findings back to the file they live in", () => {
    const sections = bugbotBundleSections({ path: "github-scan", content: BUNDLE });
    expect(sections.map((section) => section.path)).toEqual([
      "src/main/java/frc/robot/Robot.java",
      "src/main/java/frc/robot/subsystems/Arm.java",
    ]);
    expect(locateBugbotLine(sections, 7, "github-scan")).toEqual({
      path: "src/main/java/frc/robot/subsystems/Arm.java",
      line: 2,
    });
  });

  it("reports per-file locations and reviewed files for a repo bundle", () => {
    const review = mergeBugbotReview({ path: "github-scan", content: BUNDLE });
    expect(review.reviewedFiles).toEqual([
      "src/main/java/frc/robot/Robot.java",
      "src/main/java/frc/robot/subsystems/Arm.java",
    ]);
    expect(review.findings.some((item) => item.location.startsWith("src/main/java/frc/robot/Robot.java:"))).toBe(
      true,
    );
    expect(
      review.findings.some((item) => item.location.startsWith("src/main/java/frc/robot/subsystems/Arm.java:")),
    ).toBe(true);
    expect(review.findings.every((item) => item.fingerprint)).toBe(true);
  });

  it("keeps a fingerprint stable when the line moves but the code does not", () => {
    const before = bugbotFindingFingerprint({
      rule: "hardcoded-can-id",
      filePath: "Drive.java",
      evidence: "Drive.java:12: new TalonFX(3)",
    });
    const after = bugbotFindingFingerprint({
      rule: "hardcoded-can-id",
      filePath: "Drive.java",
      evidence: "Drive.java:41:  new  TalonFX(3);  // arm",
    });
    expect(after).toBe(before);
    const other = bugbotFindingFingerprint({
      rule: "hardcoded-can-id",
      filePath: "Arm.java",
      evidence: "Arm.java:12: new TalonFX(3)",
    });
    expect(other).not.toBe(before);
  });

  it("keeps the rule/file boundary unambiguous so neighbouring pairs cannot collide", () => {
    // Naive string concatenation would hash "can-id" + "Drive.java" and
    // "can" + "id-Drive.java" identically, silently merging two findings.
    expect(
      bugbotFindingFingerprint({ rule: "can-id", filePath: "Drive.java", evidence: "new TalonFX(3)" }),
    ).not.toBe(
      bugbotFindingFingerprint({ rule: "can", filePath: "id-Drive.java", evidence: "new TalonFX(3)" }),
    );
  });

  it("splits NEW from KNOWN and only calls a finding FIXED when the file was re-read", () => {
    const delta = diffBugbotFindings({
      current: [
        { fingerprint: "aaa", filePath: "Drive.java" },
        { fingerprint: "ccc", filePath: "Drive.java" },
      ],
      known: [
        { fingerprint: "aaa", filePath: "Drive.java" },
        { fingerprint: "bbb", filePath: "Drive.java" },
        { fingerprint: "ddd", filePath: "Arm.java" },
      ],
      reviewedFiles: ["Drive.java"],
    });
    expect(delta.newFingerprints).toEqual(["ccc"]);
    expect(delta.knownFingerprints).toEqual(["aaa"]);
    // bbb was re-read and is gone; ddd lives in a file this scan never opened.
    expect(delta.fixedFingerprints).toEqual(["bbb"]);
  });

  it("hides dismissed fingerprints without deleting them", () => {
    const review = mergeBugbotReview({ path: "Drive.java", content: CAN_CONFLICT });
    const target = review.findings[0]!.fingerprint!;
    const split = applyBugbotDismissals(review.findings, [target]);
    expect(split.active.some((item) => item.fingerprint === target)).toBe(false);
    expect(split.dismissed[0]?.dismissed).toBe(true);
  });

  it("scopes history per repo, and per pasted path when there is no repo", () => {
    expect(bugbotScopeKey({ githubRepo: "Team254/Robot", path: "x" })).toBe("repo:team254/robot");
    expect(bugbotScopeKey({ githubRepo: null, path: "src/Robot.java" })).toBe("buffer:src/robot.java");
  });
});
