/**
 * Software track — ordered programming units with official docs only.
 * Checkoffs stay on the phone. Required through PID + feedforward (3.1).
 */

export const SOFTWARE_TRACK_STORAGE_KEY = "vantage-software-track";

export type SoftwareTrackLink = {
  label: string;
  href: string;
};

export type SoftwareTrackUnit = {
  id: string;
  title: string;
  blurb: string;
  hrefs: SoftwareTrackLink[];
  required: boolean;
  nextId: string | null;
};

const WPILIB = "https://docs.wpilib.org/en/stable";
const FIRST = "https://www.firstinspires.org";
const CHOREO = "https://choreo.autos";
const PHOTON = "https://docs.photonvision.org";

export const SOFTWARE_TRACK_UNITS: SoftwareTrackUnit[] = [
  {
    id: "1.1",
    title: "Java Basics",
    blurb:
      "Robot code in FRC is written in Java. Learn types, methods, and classes before you touch a subsystem.",
    hrefs: [
      { label: "WPILib zero to robot", href: `${WPILIB}/docs/zero-to-robot/introduction.html` },
      { label: "WPILib basic programming", href: `${WPILIB}/docs/software/basic-programming/index.html` },
    ],
    required: true,
    nextId: "1.2",
  },
  {
    id: "1.2",
    title: "Git Basics",
    blurb:
      "Git records every change so you can undo a bad deploy. Commit on this laptop, then push when the shop network is up.",
    hrefs: [
      { label: "WPILib Git in VS Code", href: `${WPILIB}/docs/software/vscode-overview/git-getting-started.html` },
      { label: "Programming setup", href: "/dev-setup" },
    ],
    required: true,
    nextId: "1.3",
  },
  {
    id: "1.3",
    title: "Team Git Workflow",
    blurb:
      "One branch per change keeps the robot repo readable. Review before merge so a laptop crash does not wipe the only copy.",
    hrefs: [
      { label: "WPILib Git in VS Code", href: `${WPILIB}/docs/software/vscode-overview/git-getting-started.html` },
      { label: "Programming setup", href: "/dev-setup" },
    ],
    required: true,
    nextId: "2.1",
  },
  {
    id: "2.1",
    title: "WPILib / FRC programming",
    blurb:
      "WPILib is the supported toolchain for the roboRIO. Start with the official zero-to-robot path, then open a command-based project.",
    hrefs: [
      { label: "WPILib documentation", href: `${WPILIB}/` },
      { label: "Code review", href: "/code" },
    ],
    required: true,
    nextId: "2.2",
  },
  {
    id: "2.2",
    title: "Electrical intro",
    blurb:
      "Code cannot save a loose battery lead. Walk the official wiring guide before you write a motor controller call.",
    hrefs: [
      { label: "How to wire a robot", href: `${WPILIB}/docs/zero-to-robot/step-1/how-to-wire-a-robot.html` },
      { label: "FIRST technical resources", href: `${FIRST}/resources/library/frc/technical-resources` },
    ],
    required: true,
    nextId: "2.3",
  },
  {
    id: "2.3",
    title: "Commands and subsystems",
    blurb:
      "A subsystem owns hardware. A command says what that hardware should do this cycle.",
    hrefs: [
      { label: "Command-based overview", href: `${WPILIB}/docs/software/commandbased/index.html` },
    ],
    required: true,
    nextId: "2.4",
  },
  {
    id: "2.4",
    title: "Combining commands",
    blurb:
      "Sequence, parallel, and race groups build a routine from small commands. Prefer composition over one giant method.",
    hrefs: [
      { label: "Command compositions", href: `${WPILIB}/docs/software/commandbased/command-compositions.html` },
    ],
    required: true,
    nextId: "2.5",
  },
  {
    id: "2.5",
    title: "Triggers and bindings",
    blurb:
      "Triggers fire commands from buttons, sensors, or robot state. Bind them in one place so drive-team maps stay obvious.",
    hrefs: [
      { label: "Binding commands to triggers", href: `${WPILIB}/docs/software/commandbased/binding-commands-to-triggers.html` },
    ],
    required: true,
    nextId: "2.6",
  },
  {
    id: "2.6",
    title: "Logging what the robot did",
    blurb:
      "If you cannot graph a match later, you are guessing. Start with official telemetry so the signals you care about are on disk.",
    hrefs: [
      { label: "WPILib telemetry", href: `${WPILIB}/docs/software/telemetry/telemetry.html` },
    ],
    required: true,
    nextId: "2.7",
  },
  {
    id: "2.7",
    title: "Replaying a match log",
    blurb:
      "A recorded log lets you step through what the robot believed. Use it after a match instead of reconstructing from memory.",
    hrefs: [
      { label: "On-robot telemetry recording", href: `${WPILIB}/docs/software/telemetry/datalog.html` },
    ],
    required: true,
    nextId: "2.8",
  },
  {
    id: "2.8",
    title: "Logged inputs and outputs",
    blurb:
      "Keep hardware IO behind a logged boundary. That is how a replay stays honest when a motor is not plugged in.",
    hrefs: [
      { label: "WPILib telemetry annotations", href: `${WPILIB}/docs/software/telemetry/robot-telemetry-with-annotations.html` },
    ],
    required: true,
    nextId: "2.9",
  },
  {
    id: "2.9",
    title: "Simulation intro",
    blurb:
      "WPILib simulation runs robot code without a roboRIO. Use it to prove a command finishes before you waste a battery.",
    hrefs: [
      { label: "Robot simulation", href: `${WPILIB}/docs/software/wpilib-tools/robot-simulation/introduction.html` },
    ],
    required: true,
    nextId: "2.10",
  },
  {
    id: "2.10",
    title: "Simulation practice",
    blurb:
      "Drive the sim with the same bindings the driver uses. If the sim cannot finish an auto, the field will not either.",
    hrefs: [
      { label: "Simulation GUI", href: `${WPILIB}/docs/software/wpilib-tools/robot-simulation/simulation-gui.html` },
    ],
    required: true,
    nextId: "2.11",
  },
  {
    id: "2.11",
    title: "Architecture",
    blurb:
      "Split drive, intake, and scoring so one broken class does not take the robot down. Name packages the way the shop names mechanisms.",
    hrefs: [
      { label: "Command-based best practices", href: `${WPILIB}/docs/software/commandbased/organizing-command-based.html` },
    ],
    required: true,
    nextId: "3.1",
  },
  {
    id: "3.1",
    title: "PID + Feedforward",
    blurb:
      "PID corrects error. Feedforward applies the voltage you already know the mechanism needs.",
    hrefs: [
      { label: "Introduction to PID", href: `${WPILIB}/docs/software/advanced-controls/introduction/introduction-to-pid.html` },
      { label: "Introduction to feedforward", href: `${WPILIB}/docs/software/advanced-controls/introduction/introduction-to-feedforward.html` },
    ],
    required: true,
    nextId: "3.2",
  },
  {
    id: "3.2",
    title: "Motion profiling",
    blurb:
      "A trapezoid profile limits acceleration so a mechanism does not slam. Use it before you stack PID on a long throw.",
    hrefs: [
      { label: "Trapezoidal motion profiles", href: `${WPILIB}/docs/software/advanced-controls/controllers/trapezoidal-profiles.html` },
    ],
    required: false,
    nextId: "3.3",
  },
  {
    id: "3.3",
    title: "Swerve",
    blurb:
      "Swerve modules need kinematics, then heading control. Follow the official WPILib swerve notes, not a copied project.",
    hrefs: [
      { label: "Swerve drive kinematics", href: `${WPILIB}/docs/software/kinematics-and-odometry/swerve-drive-kinematics.html` },
    ],
    required: false,
    nextId: "3.4",
  },
  {
    id: "3.4",
    title: "Choreo + Auto",
    blurb:
      "Choreo builds timed paths the auto can follow. Read the official project docs before you paste waypoints.",
    hrefs: [
      { label: "Choreo documentation", href: `${CHOREO}/` },
      { label: "WPILib autonomous", href: `${WPILIB}/docs/software/commandbased/command-compositions.html` },
    ],
    required: false,
    nextId: "3.5",
  },
  {
    id: "3.5",
    title: "PhotonVision",
    blurb:
      "PhotonVision estimates pose from AprilTags. Read the official camera pipeline docs, then wire the result into your drive command.",
    hrefs: [
      { label: "PhotonVision docs", href: `${PHOTON}/` },
      { label: "Team 6925 lab", href: "/learn/6925" },
    ],
    required: false,
    nextId: "3.6",
  },
  {
    id: "3.6",
    title: "Gains tuning",
    blurb:
      "Gains are numbers you measure, not copy. Use the official PID articles and this team's tuning log.",
    hrefs: [
      { label: "Tuning a flywheel", href: `${WPILIB}/docs/software/advanced-controls/introduction/tuning-flywheel.html` },
      { label: "Tuning log", href: "/tuning-autopilot" },
    ],
    required: false,
    nextId: null,
  },
];

export const SOFTWARE_TRACK_REQUIRED_IDS = SOFTWARE_TRACK_UNITS.filter((unit) => unit.required).map(
  (unit) => unit.id,
);

export function requiredUnits(): SoftwareTrackUnit[] {
  return SOFTWARE_TRACK_UNITS.filter((unit) => unit.required);
}

export function requiredDoneCount(checkedIds: readonly string[]): number {
  const checked = new Set(checkedIds);
  return requiredUnits().filter((unit) => checked.has(unit.id)).length;
}

/** First required unit that is not checked, or null when the required prefix is done. */
export function nextRequiredId(checkedIds: readonly string[]): string | null {
  const checked = new Set(checkedIds);
  for (const unit of requiredUnits()) {
    if (!checked.has(unit.id)) return unit.id;
  }
  return null;
}

export const SOFTWARE_TRACK_PAGE_DESCRIPTION =
  "A paced programming path from Java through PID, then motion, swerve, Choreo, PhotonVision, and gains. Checkoffs stay on this phone.";
