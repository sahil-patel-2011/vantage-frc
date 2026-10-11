import { describe, expect, it } from "vitest";
import { buildCodeMap, canIdsFrom, codeMapContext, codeMapFilesToRead, duplicateCanIds, suggestCodeRef, wantsRobotCode } from "./code-map";

const blob = (path: string) => ({ path, type: "blob" });
const ENTRIES = [
  blob("build.gradle"),
  blob("vendordeps/Phoenix6.json"),
  blob("vendordeps/REVLib.json"),
  blob("vendordeps/WPILibNewCommands.json"),
  blob("src/main/java/frc/robot/Robot.java"),
  blob("src/main/java/frc/robot/Constants.java"),
  blob("src/main/java/frc/robot/subsystems/Drivetrain.java"),
  blob("src/main/java/frc/robot/subsystems/Intake.java"),
  blob("src/main/java/frc/robot/commands/IntakeNote.java"),
  blob("src/main/java/frc/robot/commands/autos/TwoPieceAuto.java"),
  blob("src/test/java/frc/robot/IntakeTest.java"),
  blob("build/tmp/Generated.java"),
  { path: "src/main/java/frc/robot/subsystems", type: "tree" },
];

const CONSTANTS = `
public final class Constants {
  public static final int kLeftLeaderId = 1;
  public static final int kRightLeaderId = 2;
  public static final int kIntakeMotorID = 9;
  public static final int kShooterCanId = 9;
  public static final double kMaxSpeed = 4.5;
  public static final int kPigeonId = 70;
}`;

describe("codeMapFilesToRead", () => {
  it("reads the GradleRIO build file and the constants file", () => {
    expect(codeMapFilesToRead(ENTRIES)).toEqual(["build.gradle", "src/main/java/frc/robot/Constants.java"]);
  });
});

describe("buildCodeMap", () => {
  const map = buildCodeMap({
    entries: ENTRIES,
    truncated: false,
    files: {
      "build.gradle": 'plugins {\n  id "java"\n  id "edu.wpi.first.GradleRIO" version "2026.2.1"\n}',
      "src/main/java/frc/robot/Constants.java": CONSTANTS,
    },
  });

  it("lists subsystems, commands and vendor libraries from the tree", () => {
    expect(map.language).toBe("java");
    expect(map.wpilibVersion).toBe("2026.2.1");
    expect(map.vendorLibraries).toEqual(["Phoenix6", "REVLib"]);
    expect(map.subsystems.map((s) => s.name)).toEqual(["Drivetrain", "Intake"]);
    expect(map.commands.map((c) => c.name)).toEqual(["IntakeNote", "TwoPieceAuto"]);
    // Tests and build output are not robot source.
    expect(map.sourceFiles).toBe(6);
  });

  it("reads CAN IDs from constants and flags one ID used twice", () => {
    expect(map.canIds.map((c) => `${c.name}=${c.id}`)).toEqual([
      "kLeftLeaderId=1",
      "kRightLeaderId=2",
      "kIntakeMotorID=9",
      "kShooterCanId=9",
    ]);
    expect(duplicateCanIds(map)).toEqual([{ id: 9, names: ["kIntakeMotorID", "kShooterCanId"] }]);
  });

  it("writes a bounded context block with recent reviews", () => {
    const text = codeMapContext({
      repoFullName: "team6925/robot",
      ref: "main",
      headSha: "a".repeat(40),
      generatedAt: "2026-10-11T12:00:00Z",
      map,
      reviews: [{ number: 12, title: "Tune intake", risk: "low", summary: "Lowers intake speed.", findingCount: 0, reviewedAt: null }],
    });
    expect(text).toMatch(/^\[Robot code\] team6925\/robot@main \(commit aaaaaaa/);
    expect(text).toMatch(/Subsystems \(2\): Drivetrain, Intake/);
    expect(text).toMatch(/Shared CAN IDs \(check wiring\): 9: kIntakeMotorID \/ kShooterCanId/);
    expect(text).toMatch(/#12 Tune intake — low risk, 0 findings/);
    expect(text.length).toBeLessThanOrEqual(4000);
  });
});

describe("canIdsFrom", () => {
  it("reads Python and C++ styles and ignores out-of-range values", () => {
    expect(canIdsFrom("constants.py", "INTAKE_CAN_ID = 12\nARM_ID: int = 14\nPDH_ID = 99").map((c) => c.id)).toEqual([12, 14]);
    expect(canIdsFrom("Constants.h", "constexpr int kElevatorID = 15;").map((c) => c.name)).toEqual(["kElevatorID"]);
  });
});

describe("wantsRobotCode", () => {
  it("adds the code map to robot and code questions only", () => {
    expect(wantsRobotCode("Why does the intake stall at full speed?")).toBe(true);
    expect(wantsRobotCode("Which CAN IDs are on the drivetrain?")).toBe(true);
    expect(wantsRobotCode("What did PR 12 change?")).toBe(true);
    expect(wantsRobotCode("Draft a thank-you email to our sponsors")).toBe(false);
    expect(wantsRobotCode("When is the next practice?")).toBe(false);
  });
});

describe("suggestCodeRef", () => {
  const SUBSYSTEMS = [
    { name: "SwerveSubsystem", path: "src/main/java/frc/robot/subsystems/SwerveSubsystem.java" },
    { name: "IntakeSubsystem", path: "src/main/java/frc/robot/subsystems/IntakeSubsystem.java" },
    { name: "ClimbSubsystem", path: "src/main/java/frc/robot/subsystems/ClimbSubsystem.java" },
    { name: "Elevator", path: "src/main/java/frc/robot/subsystems/Elevator.java" },
    { name: "Arm", path: "src/main/java/frc/robot/subsystems/Arm.java" },
    { name: "Vision", path: "src/main/java/frc/robot/subsystems/Vision.java" },
  ];

  it("matches blueprint names to code files, including common synonyms", () => {
    expect(suggestCodeRef("Drivetrain", SUBSYSTEMS)).toBe(SUBSYSTEMS[0].path);
    expect(suggestCodeRef("Intake", SUBSYSTEMS)).toBe(SUBSYSTEMS[1].path);
    expect(suggestCodeRef("Climber", SUBSYSTEMS)).toBe(SUBSYSTEMS[2].path);
    expect(suggestCodeRef("Vision & Sensors", SUBSYSTEMS)).toBe(SUBSYSTEMS[5].path);
  });

  it("leaves the choice to the team when two files fit or none do", () => {
    expect(suggestCodeRef("Elevator / Arm", SUBSYSTEMS)).toBeNull();
    expect(suggestCodeRef("Electronics", SUBSYSTEMS)).toBeNull();
    expect(suggestCodeRef("Scorer", SUBSYSTEMS)).toBeNull();
  });

  it("skips a file another subsystem already points at", () => {
    expect(suggestCodeRef("Elevator / Arm", SUBSYSTEMS, [SUBSYSTEMS[4].path])).toBe(SUBSYSTEMS[3].path);
    expect(suggestCodeRef("Intake", SUBSYSTEMS, [SUBSYSTEMS[1].path.toUpperCase()])).toBeNull();
  });
});
