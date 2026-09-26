/**
 * Team 6925 lab — W.A. Robotics (Woodward Academy, College Park, Georgia; Peachtree District).
 * Two paced tracks, programming and mechanical/CAD, written for the team's own stack. Every week
 * is broken into small steps, and every step says how it is checked before it counts: a check
 * Vantage runs (build or deploy output, a GitHub pull request or tag, code read for the exact
 * APIs the team uses, an Onshape Part Studio, measured numbers), or a lead's sign-off where no
 * software can see the work, labelled that way.
 *
 * ── What was verified about Team 6925, and where (checked 2026-09-26) ─────────────────────────
 *
 * Team
 *   - Name, school, location, district, robot names (2024 Vendetta, 2025 Eddie IV):
 *     https://warobotics.vercel.app (site repo https://github.com/sahil-patel-2011/wa-robotics)
 *   - The Blue Alliance page: https://www.thebluealliance.com/team/6925 (blocks automated reads;
 *     the event results were not used here).
 *   - Open Alliance build threads on Chief Delphi:
 *     2025 https://www.chiefdelphi.com/t/frc-team-6925-woodward-academy-robotics-2025-build-thread-open-alliance/473278
 *     2026 https://www.chiefdelphi.com/t/frc-team-6925-woodward-academy-robotics-2026-build-thread-open-alliance/512655
 *
 * Code (read file by file through the GitHub API)
 *   - Older seasons live in the team organisation https://github.com/WARbotics (Java, 2018–2023).
 *   - The 2026 robot code is https://github.com/JonathanV0/6925-Rebuilt — linked from the 2026
 *     build thread as the team's GitHub for the season. Default branch `sotm-testing`; other
 *     branches include main, Re-made, CodeWithVision, 2910-lessons. Three pull requests in total
 *     (#1 merged into main; #2 and #3 open from a fork), no tags or releases, 143 commits.
 *   - Build: GradleRIO 2026.2.1, Java 17, WPILib command-based (WPILibNewCommands vendordep),
 *     desktop simulation enabled (build.gradle).
 *   - Vendordeps: Phoenix6-26.1.1.json ("CTRE-Phoenix (v6)", frcYear 2026),
 *     PathplannerLib-2026.1.2.json, WPILibNewCommands.json. No REV, no AdvantageKit, no YAGSL.
 *   - Swerve: CTRE Tuner X Swerve Project Generator (tuner-project.json, generated/TunerConstants.java,
 *     subsystems/CommandSwerveDrivetrain.java). Talon FX drive and steer, remote CANcoders,
 *     Pigeon 2 (ID 0), all on a CANivore named "CANivore". Drive ratio 6.1224, steer 21.43,
 *     wheel radius 2 in, kSpeedAt12Volts 5.04 m/s. driveGains are still the generator's
 *     kS 0 / kV 0.124.
 *   - Mechanisms: ShooterSubsys (Talon FX 8, 9, 10, VelocityVoltage), FeederSubsys (51 and 11),
 *     IntakeSubsys (roller 45, pivot 50 with PositionVoltage slots 0–2; comment says 8:1),
 *     HoodSubsys (two PWM servos). Motor settings in CTREConfigs.java (TalonFXConfiguration,
 *     NeutralModeValue, InvertedValue, stator + supply current limits). RobotCommands.java holds
 *     multi-subsystem commands. The header comment in RobotContainer.java has drifted from the
 *     code (it says 120 A stator for the shooter; CTREConfigs sets 90 A).
 *   - Controls: CommandXboxController on port 0 (driver) and the team's own
 *     frc.lib.util.CommandX3DController on port 1 (operator).
 *   - Autos: PathPlannerLib AutoBuilder.configure in CommandSwerveDrivetrain with
 *     RobotConfig.fromGUISettings() and PPHolonomicDriveController; NamedCommands registered in
 *     RobotContainer before AutoBuilder.buildAutoChooser("M-S"); settings.json says robot mass
 *     51.48 kg, Kraken X60 drive motors.
 *   - Vision: Limelight through LimelightHelpers, MegaTag2 (SetRobotOrientation every loop,
 *     getBotPoseEstimate_wpiBlue_MegaTag2, rejects tagCount 0 and small tags, std devs scaled by
 *     distance), fed to drivetrain.addVisionMeasurement in RobotContainer.updateVision (not in
 *     autonomous). Camera pose set in LimelightSubsys (25.39 in up, 1.46 in back, 20.37° pitch).
 *     No angular-velocity rejection. While disabled, seedPoseFromVision resets the pose.
 *   - Logging: Phoenix SignalLogger.start() in Telemetry.java (.hoot logs). Telemetry is
 *     constructed but drivetrain.registerTelemetry(...) is never called (CTRE's
 *     SwerveWithPathPlanner example calls it). No DataLogManager, no AdvantageKit.
 *   - Earlier seasons: 2025 (https://github.com/Jacob6925/6925-Reefscape) used Phoenix 6,
 *     PathPlannerLib and PhotonLib; 2024 (https://github.com/BTYWAR/6925-Crescendo, linked from the
 *     2025 thread) used Phoenix 5 + 6, PathPlannerLib and PhotonLib.
 *
 * CAD and build
 *   - Onshape is the team's CAD (2025 thread links a public Onshape document of the robot).
 *   - 2025 thread: SDS MK4c swerve, 28 x 30 in base, Kraken motors, WCP GreyT cascade elevator.
 *   - 2026 thread: a WCP Competitive Concept used as a baseplate, modified for MK4i modules.
 *
 * Not verified (written generically on purpose): the team's shop rules and tool list, who
 * reviews pull requests, the exact 2027 repository, sheet-metal or 3D-printing habits, the
 * operator joystick's model name, and any practice-field layout.
 *
 * Every external href was requested and returned 200 on 2026-09-26. In-app "/" links point at a
 * directory under apps/web/app. Prefer the vendor's or program's own docs; do not add a link
 * from memory.
 */

import type { StepCheck } from "../guided/types";
import { TEAM_6925_MECHANICAL_WEEKS } from "./frc6925-mechanical";
import { TEAM_6925_PROGRAMMING_WEEKS } from "./frc6925-programming";
import { TEAM_6925_REPO } from "./frc6925-steps";

export { TEAM_6925_BRANCH, TEAM_6925_REPO, TEAM_6925_SETUP_COMMAND, repoFile } from "./frc6925-steps";

export type LabTrack = "programming" | "mechanical";

export type TeamResourceLink = {
  label: string;
  href: string;
  primary?: boolean;
};

export type TeamResourceGroup = {
  id: string;
  track: LabTrack;
  title: string;
  blurb: string;
  links: TeamResourceLink[];
};

/** One small step inside a week: what to do, why, and how it is checked before it counts. */
export type WeekTask = {
  id: string;
  title: string;
  why: string;
  do: string[];
  /** How it is checked, in the words the student reads before trying. */
  checkedBy: string;
  check: StepCheck;
  links?: TeamResourceLink[];
};

export type PacedWeek = {
  id: string;
  track: LabTrack;
  week: number;
  title: string;
  why: string;
  /** What is true when the whole week is done. */
  doneWhen: string;
  minutes: number;
  links: TeamResourceLink[];
  tasks: WeekTask[];
};

export const LAB_TRACKS: ReadonlyArray<{ id: LabTrack; title: string; blurb: string }> = [
  {
    id: "programming",
    title: "Programming",
    blurb:
      "From a new laptop to code you would trust at an event, in the team's own stack: WPILib Java, command-based, CTRE Phoenix 6 with the generated swerve drive, PathPlanner autos and Limelight MegaTag2.",
  },
  {
    id: "mechanical",
    title: "Mechanical and CAD",
    blurb:
      "From shop safety to a part you can design in Onshape, draw, make, weigh and fix in the pits. Onshape steps are checked in your own Part Studio; shop steps are signed off by a lead.",
  },
];

/** What the 2026 robot code actually uses, read from the repository. Shown at the top of the lab. */
export const TEAM_6925_STACK: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Language", value: "Java 17, WPILib 2026 command-based (GradleRIO 2026.2.1)" },
  { label: "Motors", value: "CTRE Talon FX on Phoenix 6 (26.1.1), all on a CANivore bus named “CANivore”" },
  { label: "Swerve", value: "CTRE's generated swerve (Tuner X): TunerConstants.java and CommandSwerveDrivetrain.java" },
  { label: "Autos", value: "PathPlannerLib 2026.1.2: AutoBuilder and named commands" },
  { label: "Vision", value: "Limelight with MegaTag2 through LimelightHelpers" },
  { label: "Logs", value: "Phoenix SignalLogger (.hoot files), opened in AdvantageScope" },
  { label: "Controllers", value: "Xbox controller for the driver (port 0), X3D joystick for the operator (port 1)" },
];

export const TEAM_6925_RESOURCES: TeamResourceGroup[] = [
  // ── Programming ────────────────────────────────────────────────────────
  {
    id: "laptop-setup",
    track: "programming",
    title: "Set up your laptop",
    blurb:
      "One command installs VS Code, Git, GitHub Desktop, the GitHub CLI, WPILib (with AdvantageScope), PathPlanner, Choreo and Phoenix Tuner X, and updates them if you already have them. It also signs you in to GitHub. WPILib is about 2.5 GB, so run it on home Wi-Fi, not at an event.",
    links: [
      {
        label: "WPILib installation guide",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/wpilib-setup.html",
        primary: true,
      },
      {
        label: "FRC Game Tools (Driver Station — needs an NI account)",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/frc-game-tools.html",
      },
    ],
  },
  {
    id: "team-code",
    track: "programming",
    title: "The team's robot code",
    blurb:
      "The 2026 code is public on GitHub and linked from the team's Open Alliance build thread. Its main line of work is the sotm-testing branch. Ask a programming lead which repository the current season uses before you start.",
    links: [
      { label: "2026 robot code (6925-Rebuilt)", href: TEAM_6925_REPO, primary: true },
      { label: "Older seasons (WARbotics on GitHub)", href: "https://github.com/WARbotics" },
      {
        label: "2026 build thread",
        href: "https://www.chiefdelphi.com/t/frc-team-6925-woodward-academy-robotics-2026-build-thread-open-alliance/512655",
      },
    ],
  },
  {
    id: "code",
    track: "programming",
    title: "WPILib and command-based Java",
    blurb: "WPILib is the official FRC toolchain and its docs are the reference for everything below. The robot code is command-based Java.",
    links: [
      { label: "WPILib documentation", href: "https://docs.wpilib.org/en/stable/", primary: true },
      {
        label: "Structuring a command-based project",
        href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/structuring-command-based-project.html",
      },
      {
        label: "Robot simulation",
        href: "https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/introduction.html",
      },
    ],
  },
  {
    id: "hardware",
    track: "programming",
    title: "CTRE Phoenix 6 and the swerve drive",
    blurb:
      "Every motor, CANcoder and the Pigeon 2 on the 2026 robot is a CTRE device. The drivetrain came from Tuner X's swerve generator, so CTRE's docs match the code line for line.",
    links: [
      { label: "Phoenix 6 docs", href: "https://v6.docs.ctr-electronics.com/", primary: true },
      {
        label: "Tuner X swerve generator",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/tuner/tuner-swerve/index.html",
      },
      {
        label: "Swerve API overview",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/mechanisms/swerve/swerve-overview.html",
      },
      { label: "CTRE's Phoenix 6 examples", href: "https://github.com/CrossTheRoadElec/Phoenix6-Examples" },
    ],
  },
  {
    id: "autos",
    track: "programming",
    title: "PathPlanner autos",
    blurb: "The team's autos are PathPlanner paths and autos in src/main/deploy/pathplanner, run through AutoBuilder and named commands.",
    links: [
      { label: "PathPlannerLib getting started", href: "https://pathplanner.dev/pplib-getting-started.html", primary: true },
      { label: "Named commands", href: "https://pathplanner.dev/pplib-named-commands.html" },
      { label: "Robot config", href: "https://pathplanner.dev/robot-config.html" },
    ],
  },
  {
    id: "vision",
    track: "programming",
    title: "Limelight vision",
    blurb: "The camera corrects where the robot thinks it is using AprilTags. Start with Limelight's own MegaTag2 page; it matches the code.",
    links: [
      {
        label: "Limelight MegaTag2",
        href: "https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2",
        primary: true,
      },
      { label: "LimelightHelpers (Limelight Lib)", href: "https://docs.limelightvision.io/docs/docs-limelight/apis/limelight-lib" },
    ],
  },
  {
    id: "debugging",
    track: "programming",
    title: "Logs and debugging",
    blurb: "When the robot does something odd, the log is the evidence. AdvantageScope opens Phoenix .hoot files, WPILib logs and Driver Station logs.",
    links: [
      { label: "AdvantageScope log files", href: "https://docs.advantagescope.org/overview/log-files", primary: true },
      {
        label: "Phoenix 6 signal logging",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/signal-logging.html",
      },
    ],
  },

  // ── Mechanical ─────────────────────────────────────────────────────────
  {
    id: "cad",
    track: "mechanical",
    title: "CAD in Onshape",
    blurb:
      "The team designs in Onshape. The checked Onshape track walks you through a first part and reads your own Part Studio after every step; Learn CAD goes further.",
    links: [
      { label: "Your first Onshape part, checked step by step", href: "/learn/guided/onshape-first-part", primary: true },
      { label: "Learn CAD", href: "/cad-learn" },
      { label: "Onshape Learning Center", href: "https://learn.onshape.com/" },
    ],
  },
  {
    id: "design",
    track: "mechanical",
    title: "Robot design",
    blurb:
      "FRCDesign.org teaches FRC robot design in Onshape the way strong teams do it: stock sizes, bearings, gearboxes and mechanisms.",
    links: [
      { label: "FRCDesign.org learning course", href: "https://www.frcdesign.org/learning-course/", primary: true },
      { label: "FRCDesign.org resources", href: "https://www.frcdesign.org/resources/" },
    ],
  },
  {
    id: "calculators",
    track: "mechanical",
    title: "Ratios and calculators",
    blurb:
      "Do the math before you cut: ReCalc sizes belts, chains, gears, arms and flywheels, and the gearbox calculator checks a ratio.",
    links: [
      { label: "ReCalc", href: "https://www.reca.lc/", primary: true },
      { label: "Gearbox calculator", href: "/gearbox" },
    ],
  },
  {
    id: "parts",
    track: "mechanical",
    title: "Parts on the team's robots",
    blurb:
      "The 2026 build thread describes a WCP Competitive Concept used as a baseplate with SDS MK4i swerve modules. Vendor docs list the real dimensions, so design to those, not to a guess.",
    links: [
      { label: "WCP docs", href: "https://docs.wcproducts.com/welcome", primary: true },
      { label: "SDS MK4i swerve module", href: "https://www.swervedrivespecialties.com/products/mk4i-swerve-module" },
      {
        label: "2025 build thread (links the robot's Onshape document)",
        href: "https://www.chiefdelphi.com/t/frc-team-6925-woodward-academy-robotics-2025-build-thread-open-alliance/473278",
      },
    ],
  },
  {
    id: "rules",
    track: "mechanical",
    title: "Rules, safety and inspection",
    blurb:
      "The game manual sets the weight limit, frame perimeter and safety rules for this season. Read it before you design, not after you fail inspection.",
    links: [
      {
        label: "FIRST season materials (game manual)",
        href: "https://www.firstinspires.org/resources/library/frc/season-materials",
        primary: true,
      },
      { label: "Robot inspection checklist", href: "/inspection" },
      { label: "Weight budget", href: "/weight-budget" },
    ],
  },
];

export const TEAM_6925_WEEKS: PacedWeek[] = [...TEAM_6925_PROGRAMMING_WEEKS, ...TEAM_6925_MECHANICAL_WEEKS];

export function resourcesForTrack(track: LabTrack): TeamResourceGroup[] {
  return TEAM_6925_RESOURCES.filter((group) => group.track === track);
}

export function weeksForTrack(track: LabTrack): PacedWeek[] {
  return TEAM_6925_WEEKS.filter((week) => week.track === track).sort((a, b) => a.week - b.week);
}

export function trackMinutes(track: LabTrack): number {
  return weeksForTrack(track).reduce((sum, week) => sum + week.minutes, 0);
}

export function allTeam6925Links(): TeamResourceLink[] {
  return [
    ...TEAM_6925_RESOURCES.flatMap((group) => group.links),
    ...TEAM_6925_WEEKS.flatMap((week) => [...week.links, ...week.tasks.flatMap((task) => task.links ?? [])]),
  ];
}

export function totalLabMinutes(): number {
  return TEAM_6925_WEEKS.reduce((sum, week) => sum + week.minutes, 0);
}

/** Whether Vantage runs the check itself, or a lead signs the step off. */
export function taskCheckLabel(task: Pick<WeekTask, "check">): "Vantage checks" | "A lead signs off" {
  return task.check.kind === "lead-signoff" ? "A lead signs off" : "Vantage checks";
}
