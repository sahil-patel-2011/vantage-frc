import { describe, expect, it } from "vitest";
import { buildDiffProposal, reviewFrcCode } from "../src";
import {
  CODE_COACH_LESSONS,
  CODE_COACH_MAX_HITS_PER_RULE,
  CODE_COACH_RULES,
} from "../src/coding-assistant";

const ROBOT = "src/main/java/frc/robot/Robot.java";

function patterns(content: string, path = ROBOT): string[] {
  return reviewFrcCode({ path, content }).risks.map((risk) => risk.pattern);
}

describe("FRC coding assistant", () => {
  it("flags robot-loop and hardware-map risks with file evidence", () => {
    const review = reviewFrcCode({
      path: ROBOT,
      content: "void robotPeriodic() { Thread.sleep(100); new TalonFX(3); setSupplyCurrentLimit(40); }",
    });
    expect(review.riskLevel).toBe("high");
    expect(review.risks.map(({ pattern }) => pattern)).toEqual([
      "blocking-robot-loop",
      "hardcoded-can-id",
    ]);
    expect(review.artifact.claimProvenance[0]?.sourceIds).toEqual([`file:${ROBOT}`]);
  });

  it("reports every hit with its own line number, capped per rule", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `  TalonFX m${index} = new TalonFX(${index + 1});`);
    const review = reviewFrcCode({ path: "Drive.java", content: `class Drive {\n${lines.join("\n")}\n}` });
    const hits = review.risks.filter((risk) => risk.pattern === "hardcoded-can-id");
    expect(hits).toHaveLength(CODE_COACH_MAX_HITS_PER_RULE);
    expect(hits.map((risk) => risk.line)).toEqual(
      Array.from({ length: CODE_COACH_MAX_HITS_PER_RULE }, (_, index) => index + 2),
    );
    // The evidence carries the same line the risk does.
    expect(hits[3]?.evidence.startsWith("Drive.java:5: ")).toBe(true);
    expect(hits.every((risk) => risk.lesson?.habit)).toBe(true);
  });

  it("flags every duplicate CAN id on the same device class", () => {
    const review = reviewFrcCode({
      path: "Drive.java",
      content: [
        "TalonFX a = new TalonFX(3);",
        "TalonFX b = new TalonFX(3);",
        "TalonFX c = new TalonFX(3);",
        "CANcoder d = new CANcoder(3);",
      ].join("\n"),
    });
    const dupes = review.risks.filter((risk) => risk.pattern === "can-id-collision");
    // Two duplicates of TalonFX(3); the CANcoder is a different class on the same id.
    expect(dupes.map((risk) => risk.line)).toEqual([2, 3]);
  });

  it("flags unbounded loops and prints inside periodic bodies, and stays quiet outside them", () => {
    const inside = [
      "public void teleopPeriodic() {",
      "  while (!limit.get()) { arm.set(0.3); }",
      "  System.out.println(\"tick\");",
      "}",
      "public void execute() {",
      "  for (;;) { io.poll(); }",
      "}",
    ].join("\n");
    const found = patterns(inside);
    expect(found.filter((item) => item === "unbounded-loop-in-periodic")).toHaveLength(2);
    expect(found).toContain("loop-overrun-print");

    const outside = [
      "public void robotInit() {",
      "  while (!gyro.isCalibrated()) { Timer.delay(0.01); }",
      "  System.out.println(\"ready\");",
      "}",
    ].join("\n");
    const quiet = patterns(outside);
    expect(quiet).not.toContain("unbounded-loop-in-periodic");
    expect(quiet).not.toContain("loop-overrun-print");
  });

  it("flags literal ports outside Constants and allows them inside", () => {
    const source = "DigitalInput beam = new DigitalInput(4);\nServo hood = new Servo(1);\nEncoder enc = new Encoder(0, 1);";
    const outside = reviewFrcCode({ path: "src/main/java/frc/robot/subsystems/Intake.java", content: source });
    expect(outside.risks.filter((risk) => risk.pattern === "hardcoded-io-port").map((risk) => risk.line)).toEqual([
      1, 2, 3,
    ]);
    expect(patterns(source, "src/main/java/frc/robot/Constants.java")).not.toContain("hardcoded-io-port");
    expect(patterns(`public final class Constants {\n${source}\n}`, "src/main/java/frc/robot/Ports.java")).not.toContain(
      "hardcoded-io-port",
    );
  });

  it("flags motor safety off, a PDH with no brownout handling, and an unstated follower inversion", () => {
    const risky = [
      "PowerDistribution pdh = new PowerDistribution(1, ModuleType.kRev);",
      "drive.setSafetyEnabled(false);",
      "rightFollower.follow(rightLeader);",
    ].join("\n");
    const found = patterns(risky, "Drive.java");
    expect(found).toContain("brownout-handling-missing");
    expect(found).toContain("motor-safety-disabled");
    expect(found).toContain("follower-inversion-unstated");

    const handled = [
      "PowerDistribution pdh = new PowerDistribution(1, ModuleType.kRev);",
      "if (RobotController.isBrownedOut()) { climber.stop(); }",
      "rightFollower.follow(rightLeader, true);",
    ].join("\n");
    const quiet = patterns(handled, "Drive.java");
    expect(quiet).not.toContain("brownout-handling-missing");
    expect(quiet).not.toContain("follower-inversion-unstated");
  });

  it("flags deprecated APIs, empty catch blocks, and dashboard writes inside tight loops", () => {
    const source = [
      "import edu.wpi.first.wpilibj.PIDController;",
      "SpeedControllerGroup left = new SpeedControllerGroup(a, b);",
      "CANSparkMax m = new CANSparkMax(5, MotorType.kBrushless);",
      "try { config.apply(); } catch (Exception e) { }",
      "try { config.apply(); } catch (Exception e) { // ignore",
      "}",
      "for (int i = 0; i < modules.length; i++) {",
      "  SmartDashboard.putNumber(\"m\" + i, modules[i].getAngle());",
      "}",
    ].join("\n");
    const review = reviewFrcCode({ path: "Drive.java", content: source });
    const byPattern = (pattern: string) => review.risks.filter((risk) => risk.pattern === pattern);
    expect(byPattern("deprecated-wpilib-api").map((risk) => risk.line)).toEqual([1, 2, 3]);
    expect(byPattern("empty-catch-block").map((risk) => risk.line)).toEqual([4, 5]);
    expect(byPattern("dashboard-put-in-tight-loop").map((risk) => risk.line)).toEqual([8]);
    // A dashboard put once per tick is normal WPILib practice, not a tight loop.
    expect(patterns("public void periodic() {\n  SmartDashboard.putNumber(\"x\", 1);\n}")).not.toContain(
      "dashboard-put-in-tight-loop",
    );
  });

  it("flags a command-based robotPeriodic without the scheduler run, and hard-coded alliance colour", () => {
    const noRun = [
      "import edu.wpi.first.wpilibj2.command.CommandScheduler;",
      "public class Robot extends TimedRobot {",
      "  private RobotContainer container;",
      "  public void robotPeriodic() {",
      "    container.updateTelemetry();",
      "  }",
      "}",
    ].join("\n");
    expect(reviewFrcCode({ path: ROBOT, content: noRun }).risks.find((risk) => risk.pattern === "missing-scheduler-run")?.line).toBe(
      4,
    );
    const withRun = noRun.replace("container.updateTelemetry();", "CommandScheduler.getInstance().run();");
    expect(patterns(withRun)).not.toContain("missing-scheduler-run");
    // A non-command-based robot has no scheduler to run.
    expect(patterns("public class Robot extends TimedRobot {\n  public void robotPeriodic() {\n  }\n}")).not.toContain(
      "missing-scheduler-run",
    );

    const alliance = [
      "Alliance alliance = Alliance.Red;",
      "boolean isRed = true;",
      "var side = DriverStation.Alliance.Blue;",
      "return Alliance.Blue;",
    ].join("\n");
    expect(
      reviewFrcCode({ path: "Auto.java", content: alliance })
        .risks.filter((risk) => risk.pattern === "hardcoded-alliance-colour")
        .map((risk) => risk.line),
    ).toEqual([1, 2, 3, 4]);
    expect(patterns("var alliance = DriverStation.getAlliance().orElse(Alliance.Blue);")).not.toContain(
      "hardcoded-alliance-colour",
    );
  });

  it("ships at least fourteen FRC rules, each with an id, severity, message, and lesson", () => {
    expect(CODE_COACH_RULES.length).toBeGreaterThanOrEqual(14);
    expect(new Set(CODE_COACH_RULES.map((rule) => rule.id)).size).toBe(CODE_COACH_RULES.length);
    for (const rule of CODE_COACH_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/);
      expect(["high", "medium", "low"]).toContain(rule.severity);
      expect(rule.message.length).toBeGreaterThan(20);
      expect(rule.lesson.flag.length).toBeGreaterThan(5);
      expect(rule.lesson.explain.length).toBeGreaterThan(20);
      expect(rule.lesson.habit.length).toBeGreaterThan(20);
      expect(CODE_COACH_LESSONS[rule.id]).toBe(rule.lesson);
    }
  });

  it("only ever quotes text that is in the file", () => {
    const content = [
      "public void teleopPeriodic() {",
      "  while (true) { drive.setSafetyEnabled(false); }",
      "  System.out.println(\"x\");",
      "}",
      "try { a(); } catch (Exception e) { }",
      "new TalonFX(3); new TalonFX(3);",
    ].join("\n");
    const review = reviewFrcCode({ path: "Robot.java", content });
    expect(review.risks.length).toBeGreaterThan(4);
    for (const risk of review.risks) {
      const quoted = risk.evidence.replace(/^Robot\.java:\d+: /, "");
      expect(content.replace(/\s+/g, " ")).toContain(quoted);
    }
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
