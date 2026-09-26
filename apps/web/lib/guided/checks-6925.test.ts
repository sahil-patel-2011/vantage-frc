import { describe, expect, it, vi } from "vitest";
import {
  DEPLOY_TO_6925,
  checkChangedFiles,
  checkPullRequestChanges,
  evaluatePaste,
  nonZeroCall,
  parseGitHubFileUrl,
  runPasteVerifier,
  stripJavaComments,
} from "./checks-6925";
import { guidedStep } from "./tracks";
import type { StepCheck } from "./types";

type Paste = Extract<StepCheck, { kind: "paste" }>;
type Pr = Extract<StepCheck, { kind: "github-pr" }>;

function paste(stepId: string): Paste {
  const check = guidedStep("frc6925-programming", stepId)?.check;
  if (!check || check.kind !== "paste") throw new Error(`${stepId} is a paste check`);
  return check;
}

function pr(stepId: string): Pr {
  const check = guidedStep("frc6925-programming", stepId)?.check;
  if (!check || check.kind !== "github-pr") throw new Error(`${stepId} is a pull request check`);
  return check;
}

/* Real output shapes: GradleRIO/deploy-utils prints "Using <user>@<host>:<port> for target roborio". */
const DEPLOY_LOG = [
  "> Task :discoverroborio",
  "Discovering Target roborio",
  "Using admin@10.69.25.2:22 for target roborio",
  "Target discovery succeeded in 812 ms",
  "> Task :deployfrcJavaroborio",
  "BUILD SUCCESSFUL in 21s",
  "8 actionable tasks: 4 executed, 4 up-to-date",
].join("\n");
const CONSOLE = "********** Robot program startup complete **********";

describe("stripJavaComments", () => {
  it("drops line and block comments but keeps strings that look like comments", () => {
    const source = [
      'String url = "http://x"; // trailing',
      "/* block",
      "   comment */ int a = 1;",
      "// NamedCommands.registerCommand(\"x\", y);",
      "char c = '/';",
      'String block = """',
      "  // inside a text block",
      '""";',
    ].join("\n");
    const out = stripJavaComments(source);
    expect(out).toContain('"http://x"');
    expect(out).not.toContain("trailing");
    expect(out).not.toContain("block\n   comment");
    expect(out).toContain("int a = 1;");
    expect(out).not.toContain("registerCommand");
    expect(out).toContain("'/'");
    expect(out).toContain("// inside a text block");
    expect(out.split("\n").length).toBe(source.split("\n").length);
  });
  it("copes with an unterminated comment or string", () => {
    expect(stripJavaComments("int a; /* never closed")).toBe("int a;  ");
    expect(stripJavaComments('String s = "open')).toBe('String s = "open');
  });
});

describe("nonZeroCall", () => {
  const re = new RegExp(nonZeroCall(String.raw`\.withKS`));
  it("accepts a real value or a named constant and refuses zero", () => {
    expect(re.test(".withKS(0.18)")).toBe(true);
    expect(re.test(".withKS(.2)")).toBe(true);
    expect(re.test(".withKS(DriveConstants.kS)")).toBe(true);
    expect(re.test(".withKS(0)")).toBe(false);
    expect(re.test(".withKS(0.0)")).toBe(false);
    expect(re.test(".withKS( 0 )")).toBe(false);
  });
});

describe("week 1: tools, clone, vendordeps, build, deploy", () => {
  it("prog-1-tools passes real version output and refuses a missing command", () => {
    const check = paste("prog-1-tools");
    const ok = "git version 2.47.1.windows.2\ngh version 2.63.2 (2024-12-05)\ngithub.com\n  ✓ Logged in to github.com account alex (keyring)";
    expect(evaluatePaste(check, ok).passed).toBe(true);
    const noLogin = evaluatePaste(check, "git version 2.47.1\ngh version 2.63.2\nYou are not logged into any GitHub hosts.");
    expect(noLogin.passed).toBe(false);
    expect(noLogin.message).toMatch(/gh auth login/);
    const missing = evaluatePaste(check, `${ok}\ngh : The term 'gh' is not recognized as the name of a cmdlet`);
    expect(missing.passed).toBe(false);
    expect(missing.message).toMatch(/new one/);
  });

  it("prog-1-clone wants a GitHub remote and a branch, not a stray folder", () => {
    const check = paste("prog-1-clone");
    const ok = "origin\thttps://github.com/JonathanV0/6925-Rebuilt.git (fetch)\norigin\thttps://github.com/JonathanV0/6925-Rebuilt.git (push)\nOn branch sotm-testing";
    expect(evaluatePaste(check, ok).passed).toBe(true);
    expect(evaluatePaste(check, "fatal: not a git repository (or any of the parent directories): .git").passed).toBe(false);
    expect(evaluatePaste(check, "origin\thttps://gitlab.com/a/b.git (fetch)\nOn branch main").passed).toBe(false);
  });

  it("prog-1-vendordeps reads the Phoenix 6 file and refuses last season or the wrong library", () => {
    const check = paste("prog-1-vendordeps");
    const file = (name: string, version: string, frcYear: string) => JSON.stringify({ fileName: "x.json", name, version, frcYear, uuid: "e995de00" });
    const ok = evaluatePaste(check, file("CTRE-Phoenix (v6)", "26.1.1", "2026"));
    expect(ok.passed).toBe(true);
    expect(ok.message).toBe("Checked: Phoenix 6 26.1.1 for the 2026 season.");
    const old = evaluatePaste(check, file("CTRE-Phoenix (v6)", "25.3.2", "2025"));
    expect(old.passed).toBe(false);
    expect(old.message).toMatch(/2025 season/);
    expect(evaluatePaste(check, file("CTRE-Phoenix (v5)", "5.35.1", "2026")).message).toMatch(/Phoenix 6 file/);
    expect(evaluatePaste(check, file("PathplannerLib", "2026.1.2", "2026")).passed).toBe(false);
    expect(evaluatePaste(check, "{ not json").message).toMatch(/not a vendordeps file/);
    expect(evaluatePaste(check, JSON.stringify({ name: "CTRE-Phoenix (v6)", frcYear: "2026" })).message).toMatch(/no version/);
  });

  it("prog-1-build passes a green build and refuses BUILD FAILED even when it also says SUCCESSFUL", () => {
    const check = paste("prog-1-build");
    expect(evaluatePaste(check, "BUILD SUCCESSFUL in 9s\n5 actionable tasks: 5 executed").passed).toBe(true);
    expect(evaluatePaste(check, "BUILD SUCCESSFUL in 9s").passed).toBe(false);
    const mixed = evaluatePaste(check, "BUILD SUCCESSFUL in 9s\n5 actionable tasks: 5 executed\nBUILD FAILED in 2s");
    expect(mixed.passed).toBe(false);
    expect(mixed.message).toMatch(/BUILD FAILED/);
  });

  it("prog-1 needs the deploy to reach a 6925 roboRIO and the program to start", () => {
    const check = paste("prog-1");
    expect(evaluatePaste(check, `${DEPLOY_LOG}\n${CONSOLE}`).passed).toBe(true);
    expect(evaluatePaste(check, `${DEPLOY_LOG.replace("10.69.25.2", "roborio-6925-frc.local")}\n${CONSOLE}`).passed).toBe(true);
    expect(evaluatePaste(check, `${DEPLOY_LOG.replace("10.69.25.2", "172.22.11.2")}\n${CONSOLE}`).passed).toBe(true);
    // Another team's robot, a build that never deployed, and a deploy with no program start all fail.
    expect(evaluatePaste(check, `${DEPLOY_LOG.replace("10.69.25.2", "10.2.54.2")}\n${CONSOLE}`).message).toMatch(/6925 roboRIO/);
    expect(evaluatePaste(check, `BUILD SUCCESSFUL in 3s\n${CONSOLE}`).passed).toBe(false);
    expect(evaluatePaste(check, DEPLOY_LOG).message).toMatch(/robot program started/);
  });

  it("matches only the deploy-utils line shape", () => {
    const re = new RegExp(DEPLOY_TO_6925, "i");
    expect(re.test("Using lvuser@roborio-6925-frc.frc-field.local:22 for target roborio")).toBe(true);
    expect(re.test("Using admin@roborio-69250-frc.local:22 for target roborio")).toBe(false);
    expect(re.test("roborio-6925-frc.local")).toBe(false);
  });
});

describe("week 2: branches and pushes", () => {
  it("prog-2-branch refuses the shared branch", () => {
    const check = paste("prog-2-branch");
    expect(evaluatePaste(check, "On branch alex/feeder-comment\nnothing to commit, working tree clean").passed).toBe(true);
    expect(evaluatePaste(check, "On branch sotm-testing\nYour branch is up to date").message).toMatch(/shared branch/);
    expect(evaluatePaste(check, "On branch main").passed).toBe(false);
  });

  it("prog-2-commit needs a real push, not only a log that mentions HEAD ->", () => {
    const check = paste("prog-2-commit");
    const log = "a1b2c3d (HEAD -> alex/x) Fix shooter current limit comment\n9f8e7d6 Diff speeds for each feeder motor";
    const pushNew = "To https://github.com/JonathanV0/6925-Rebuilt.git\n * [new branch]      alex/x -> alex/x";
    const pushUpdate = "To https://github.com/JonathanV0/6925-Rebuilt.git\n   1a2b3c4..5d6e7f8  alex/x -> alex/x";
    expect(evaluatePaste(check, `${pushNew}\n${log}`).passed).toBe(true);
    expect(evaluatePaste(check, `${pushUpdate}\n${log}`).passed).toBe(true);
    expect(evaluatePaste(check, log).message).toMatch(/no push output/);
    expect(evaluatePaste(check, `${pushNew}\n ! [rejected]        alex/x -> alex/x (fetch first)\n${log}`).message).toMatch(/rejected/);
  });
});

describe("Java checks ignore comments", () => {
  const shooter = [
    'private final TalonFX fuelShoot = new TalonFX(8, "CANivore");',
    'private final TalonFX fuelShoot0 = new TalonFX(9, "CANivore");',
    'private final TalonFX fuelShoot1 = new TalonFX(10, "CANivore");',
  ].join("\n");

  it("prog-3-read passes the three CANivore motors and fails two, or motors on the roboRIO bus", () => {
    const check = paste("prog-3-read");
    expect(evaluatePaste(check, shooter).passed).toBe(true);
    expect(evaluatePaste(check, shooter.split("\n").slice(0, 2).join("\n")).passed).toBe(false);
    expect(evaluatePaste(check, shooter.replaceAll(', "CANivore"', "")).passed).toBe(false);
  });

  it("says so when the only match is inside a comment", () => {
    const check = paste("prog-3-read");
    const commented = shooter
      .split("\n")
      .map((line) => `// ${line}`)
      .join("\n");
    const result = evaluatePaste(check, `${commented}\nint x = 1;`);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/inside a comment/);
    expect(evaluatePaste(check, "// only a comment").message).toMatch(/everything pasted is a comment/);
  });

  it("prog-3-bind accepts controller triggers and refuses JoystickButton", () => {
    const check = paste("prog-3-bind");
    expect(evaluatePaste(check, "operator.button(3).whileTrue(RobotCommands.reverseAll());").passed).toBe(true);
    expect(evaluatePaste(check, "joystick.a().onTrue(drivetrain.runOnce(drivetrain::seedFieldCentric));").passed).toBe(true);
    expect(evaluatePaste(check, "// operator.button(15).whileTrue(RobotCommands.windUp());").passed).toBe(false);
    expect(
      evaluatePaste(check, "new JoystickButton(stick, 3).whileTrue(cmd);\noperator.button(3).whileTrue(cmd);").message,
    ).toMatch(/JoystickButton/);
  });

  it("prog-3-sim passes a clean simulation start and refuses a robot code exception", () => {
    const check = paste("prog-3-sim");
    const sim = "> Task :simulateJava\nHAL Extensions: Attempting to load: halsim_gui\nSimulator GUI Initializing.\n********** Robot program startup complete **********";
    expect(evaluatePaste(check, sim).passed).toBe(true);
    expect(evaluatePaste(check, `${sim}\nException in thread "main" java.lang.NullPointerException\n\tat frc.robot.RobotContainer.<init>(RobotContainer.java:40)`).passed).toBe(false);
    expect(evaluatePaste(check, "********** Robot program startup complete **********").message).toMatch(/simulation output/);
  });

  it("prog-4 passes a full Phoenix 6 config and names what is missing", () => {
    const check = paste("prog-4");
    const config = [
      "public static final TalonFXConfiguration FEEDER_CONFIG = new TalonFXConfiguration();",
      "FEEDER_CONFIG.MotorOutput.NeutralMode = NeutralModeValue.Coast;",
      "FEEDER_CONFIG.MotorOutput.Inverted = InvertedValue.CounterClockwise_Positive;",
      "FEEDER_CONFIG.CurrentLimits.StatorCurrentLimitEnable = true;",
      "FEEDER_CONFIG.CurrentLimits.StatorCurrentLimit = 40;",
      "FEEDER_CONFIG.CurrentLimits.SupplyCurrentLimitEnable = true;",
      "FEEDER_CONFIG.CurrentLimits.SupplyCurrentLimit = 40;",
      "feeder.getConfigurator().apply(CTREConfigs.FEEDER_CONFIG);",
    ].join("\n");
    expect(evaluatePaste(check, config).passed).toBe(true);
    expect(evaluatePaste(check, config.replace(/.*Inverted.*\n/, "")).message).toMatch(/no inversion/);
    expect(evaluatePaste(check, config.replace("feeder.getConfigurator().apply", "// feeder.getConfigurator().apply")).message).toMatch(/never applied/);
    expect(evaluatePaste(check, `${config}\nFEEDER_CONFIG.CurrentLimits.SupplyCurrentLimitEnable = false;`).message).toMatch(/switched off/);
    expect(evaluatePaste(check, `${config}\nWPI_TalonFX old = new WPI_TalonFX(3);`).message).toMatch(/Phoenix 5/);
  });

  it("prog-5 wants SysId gains in driveGains, not the generator's", () => {
    const check = paste("prog-5");
    const generated = [
      "private static final Slot0Configs steerGains = new Slot0Configs()",
      "    .withKP(80).withKI(0).withKD(.5)",
      "    .withKS(0.1).withKV(2.66).withKA(0);",
      "private static final Slot0Configs driveGains = new Slot0Configs()",
      "    .withKP(0.1).withKI(0).withKD(0)",
      "    .withKS(0).withKV(0.124);",
    ].join("\n");
    expect(evaluatePaste(check, generated).message).toMatch(/kS 0/);
    expect(evaluatePaste(check, generated.replace(".withKS(0).withKV(0.124)", ".withKS(0.21).withKV(0.124)")).message).toMatch(/0\.124/);
    expect(evaluatePaste(check, generated.replace(".withKS(0).withKV(0.124)", ".withKS(0.21).withKV(0.118)")).passed).toBe(true);
    // A non-zero kS in steerGains does not count for the drive.
    expect(evaluatePaste(check, generated.replace(".withKV(0.124)", ".withKV(0.118)")).passed).toBe(false);
  });

  it("prog-6-telemetry needs registerTelemetry in code, not in a comment", () => {
    const check = paste("prog-6-telemetry");
    expect(evaluatePaste(check, "drivetrain.registerTelemetry(logger::telemeterize);").passed).toBe(true);
    expect(evaluatePaste(check, "// drivetrain.registerTelemetry(logger::telemeterize);\nint a;").passed).toBe(false);
    expect(evaluatePaste(check, "drivetrain.registerTelemetry(state -> {});").passed).toBe(false);
  });

  it("prog-7 requires named commands before the auto chooser", () => {
    const check = paste("prog-7");
    const good = [
      'NamedCommands.registerCommand("shoot", RobotCommands.Shoot());',
      'NamedCommands.registerCommand("IntakeFast", RobotCommands.intakeFast());',
      'autoChooser = AutoBuilder.buildAutoChooser("M-S");',
    ].join("\n");
    expect(evaluatePaste(check, good).passed).toBe(true);
    const late = `${good}\nNamedCommands.registerCommand("late", Commands.none());`;
    expect(evaluatePaste(check, late).message).toMatch(/after buildAutoChooser/);
    expect(evaluatePaste(check, 'autoChooser = AutoBuilder.buildAutoChooser("M-S");').message).toMatch(/registerCommand/);
  });

  it("prog-8 needs a spin check on top of the MegaTag2 basics", () => {
    const check = paste("prog-8");
    const current = [
      "LimelightHelpers.SetRobotOrientation(name, currentPose.getRotation().getDegrees(), 0, 0, 0, 0, 0);",
      "final PoseEstimate poseEstimate = LimelightHelpers.getBotPoseEstimate_wpiBlue_MegaTag2(name);",
      "if (poseEstimate == null || poseEstimate.tagCount == 0) return Optional.empty();",
      "drivetrain.addVisionMeasurement(m.poseEstimate.pose, m.poseEstimate.timestampSeconds, m.standardDeviations);",
    ].join("\n");
    expect(evaluatePaste(check, current).message).toMatch(/how fast the robot is turning/);
    const withSpin = `${current}\nif (Math.abs(drivetrain.getState().Speeds.omegaRadiansPerSecond) > 2 * Math.PI) return;`;
    expect(evaluatePaste(check, withSpin).passed).toBe(true);
    expect(evaluatePaste(check, withSpin.replace("tagCount == 0", "tagCount > 5")).passed).toBe(false);
  });

  it("prog-9-datalog needs both DataLogManager lines", () => {
    const check = paste("prog-9-datalog");
    expect(evaluatePaste(check, "DataLogManager.start();\nDriverStation.startDataLog(DataLogManager.getLog());").passed).toBe(true);
    expect(evaluatePaste(check, "DataLogManager.start();").message).toMatch(/Driver Station is not logged/);
  });

  it("prog-10-rollback needs git on the tag's commit and a 6925 deploy", () => {
    const check = paste("prog-10-rollback");
    const git = "HEAD is now at 26368d7 Diff speeds for each feeder motor";
    expect(evaluatePaste(check, `${git}\n${DEPLOY_LOG}`).passed).toBe(true);
    expect(evaluatePaste(check, DEPLOY_LOG).message).toMatch(/HEAD is now at/);
    expect(evaluatePaste(check, `${git}\nBUILD SUCCESSFUL in 4s`).passed).toBe(false);
  });
});

describe("parseGitHubFileUrl", () => {
  it("turns a file link into its raw address and refuses anything else", () => {
    expect(parseGitHubFileUrl("https://github.com/JonathanV0/6925-Rebuilt/blob/sotm-testing/src/main/java/frc/robot/Robot.java")).toEqual({
      owner: "JonathanV0",
      repo: "6925-Rebuilt",
      refAndPath: "sotm-testing/src/main/java/frc/robot/Robot.java",
      raw: "https://raw.githubusercontent.com/JonathanV0/6925-Rebuilt/sotm-testing/src/main/java/frc/robot/Robot.java",
    });
    const spaced = parseGitHubFileUrl("https://github.com/a/b/blob/main/src/main/deploy/pathplanner/autos/Turn%20test.auto");
    expect(spaced?.raw).toBe("https://raw.githubusercontent.com/a/b/main/src/main/deploy/pathplanner/autos/Turn%20test.auto");
    expect(parseGitHubFileUrl("https://github.com/a/b/tree/main/src")).toBeNull();
    expect(parseGitHubFileUrl("https://github.com/a/b/blob/main")).toBeNull();
    expect(parseGitHubFileUrl("https://evil.example/a/b/blob/main/x.java")).toBeNull();
    expect(parseGitHubFileUrl("http://github.com/a/b/blob/main/x.java")).toBeNull();
    expect(parseGitHubFileUrl("https://github.com/a/b/blob/main/%2E%2E/x.java")).toBeNull();
    expect(parseGitHubFileUrl("int a = 1; https://github.com/a/b/blob/main/x.java")).toBeNull();
  });
});

describe("runPasteVerifier", () => {
  const check = paste("prog-6-telemetry");
  const link = "https://github.com/JonathanV0/6925-Rebuilt/blob/sotm-testing/src/main/java/frc/robot/RobotContainer.java";

  it("reads the file from GitHub when a file link is pasted", async () => {
    const fetchImpl = vi.fn(async () => new Response("public class RobotContainer {\n  drivetrain.registerTelemetry(logger::telemeterize);\n}"));
    const result = await runPasteVerifier(check, link, fetchImpl as unknown as typeof fetch);
    expect(result.passed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/JonathanV0/6925-Rebuilt/sotm-testing/src/main/java/frc/robot/RobotContainer.java",
      expect.any(Object),
    );
    expect(result.evidence?.[0]).toBe("Read from GitHub: JonathanV0/6925-Rebuilt, sotm-testing/src/main/java/frc/robot/RobotContainer.java");
  });

  it("checks the file's real contents, so the 2026 file without the line fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("private final Telemetry logger = new Telemetry(MaxSpeed);"));
    const result = await runPasteVerifier(check, link, fetchImpl as unknown as typeof fetch);
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/registerTelemetry/);
  });

  it("explains a missing or private file, and a link that is not a file", async () => {
    const notFound = vi.fn(async () => new Response("404: Not Found", { status: 404 }));
    expect((await runPasteVerifier(check, link, notFound as unknown as typeof fetch)).message).toMatch(/private/);
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    expect((await runPasteVerifier(check, link, offline as unknown as typeof fetch)).message).toMatch(/did not answer/);
    const never = vi.fn();
    expect((await runPasteVerifier(check, "https://github.com/a/b/pull/3", never as unknown as typeof fetch)).message).toMatch(/not a file on GitHub/);
    expect(never).not.toHaveBeenCalled();
  });

  it("does not fetch when the step does not allow file links", async () => {
    const vision = paste("prog-8");
    const never = vi.fn();
    const result = await runPasteVerifier(vision, link, never as unknown as typeof fetch);
    expect(never).not.toHaveBeenCalled();
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/needs the text itself, not a link/);
  });
});

describe("pull request file changes", () => {
  it("prog-3 wants a Java change, prog-7-auto a PathPlanner file, prog-10-ci a workflow", () => {
    const java = pr("prog-3").changes!;
    expect(checkChangedFiles(["src/main/java/frc/robot/RobotContainer.java"], java).passed).toBe(true);
    expect(checkChangedFiles(["README.md"], java).message).toMatch(/does not change a Java file/);
    const auto = pr("prog-7-auto").changes!;
    expect(checkChangedFiles(["src/main/deploy/pathplanner/autos/M-S.auto", "src/main/deploy/pathplanner/paths/RB-S.path"], auto).passed).toBe(true);
    expect(checkChangedFiles(["src/main/deploy/pathplanner/settings.json"], auto).passed).toBe(false);
    const ci = pr("prog-10-ci").changes!;
    expect(checkChangedFiles([".github/workflows/build.yml"], ci).passed).toBe(true);
    expect(checkChangedFiles(["docs/.github/workflows/build.yml"], ci).passed).toBe(false);
    const vision = pr("prog-8-pr").changes!;
    expect(checkChangedFiles(["src/main/java/frc/robot/subsystems/LimelightSubsys.java"], vision).passed).toBe(true);
    expect(checkChangedFiles(["src/main/java/frc/robot/subsystems/ShooterSubsys.java"], vision).passed).toBe(false);
  });

  it("asks GitHub for the files and keeps the pull request evidence first", async () => {
    const github = vi.fn(async () => Response.json([{ filename: "src/main/java/frc/robot/Robot.java" }]));
    const result = await checkPullRequestChanges({ owner: "a", repo: "b", number: 7 }, pr("prog-3").changes!, github, ["Pull request #7"]);
    expect(github).toHaveBeenCalledWith("/repos/a/b/pulls/7/files?per_page=100");
    expect(result.passed).toBe(true);
    expect(result.evidence?.[0]).toBe("Pull request #7");
    const limited = vi.fn(async () => new Response("", { status: 403 }));
    expect((await checkPullRequestChanges({ owner: "a", repo: "b", number: 7 }, pr("prog-3").changes!, limited)).message).toMatch(/limiting/);
    const down = vi.fn(async () => null);
    expect((await checkPullRequestChanges({ owner: "a", repo: "b", number: 7 }, pr("prog-3").changes!, down)).passed).toBe(false);
  });
});
