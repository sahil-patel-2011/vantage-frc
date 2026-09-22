/**
 * Team 6925 lab — two paced tracks, programming and mechanical, each with the
 * official docs a new student should open first.
 *
 * Every external href was requested with curl and returned 200 before it went
 * in here (in-app "/" links point at a directory under apps/web/app). Prefer
 * the vendor's or program's own docs over mirrors and forum threads.
 * Do not add a link from memory.
 */

import { LIVE_SITE_ORIGIN } from "../site";

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

export type PacedWeek = {
  id: string;
  track: LabTrack;
  week: number;
  title: string;
  why: string;
  steps: string[];
  verify: string;
  minutes: number;
  links: TeamResourceLink[];
};

export const LAB_TRACKS: ReadonlyArray<{ id: LabTrack; title: string; blurb: string }> = [
  {
    id: "programming",
    title: "Programming",
    blurb:
      "From a fresh laptop to code you would trust on the field at an event: Git, command-based Java, motor controllers, control loops, swerve, autos, vision and logs.",
  },
  {
    id: "mechanical",
    title: "Mechanical",
    blurb:
      "From shop safety to a mechanism you can design, draw, build, weigh and fix in the pits: Onshape, materials, power transmission, prototyping and inspection.",
  },
];

/**
 * One command that sets a Windows laptop up for robot code, or brings an old
 * one current. Paste it into PowerShell.
 *
 * It resolves WPILib and PathPlanner from their official release feeds at run
 * time rather than pinning a version here, so it does not go stale mid-season.
 * The script is `apps/web/public/team-setup.ps1`.
 */
export const TEAM_6925_SETUP_COMMAND = `irm ${LIVE_SITE_ORIGIN}/team-setup.ps1 | iex`;

export const TEAM_6925_RESOURCES: TeamResourceGroup[] = [
  // ── Programming ────────────────────────────────────────────────────────
  {
    id: "laptop-setup",
    track: "programming",
    title: "Set up your laptop",
    blurb:
      "One command installs VS Code, Git, WPILib and PathPlanner — and updates them if you already have them. Run it in PowerShell. WPILib is about 2.5 GB, so do it on home Wi-Fi, not at an event.",
    links: [
      {
        label: "Zero to Robot — the official walkthrough",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html",
        primary: true,
      },
      {
        label: "FRC Game Tools (Driver Station — needs an NI account)",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/frc-game-tools.html",
      },
    ],
  },
  {
    id: "code",
    track: "programming",
    title: "Robot code",
    blurb:
      "WPILib is the official FRC toolchain and its docs are the reference for everything below. Our robot code is command-based Java.",
    links: [
      { label: "WPILib documentation", href: "https://docs.wpilib.org/en/stable/", primary: true },
      {
        label: "Command-based programming",
        href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/index.html",
      },
      {
        label: "WPILib example projects",
        href: "https://docs.wpilib.org/en/stable/docs/software/examples-tutorials/wpilib-examples.html",
      },
    ],
  },
  {
    id: "hardware",
    track: "programming",
    title: "Motors and controllers",
    blurb:
      "Vendor docs for the controllers that actually show up on a 6925 bill of materials: REV SPARK MAX and SPARK Flex, and CTRE Talon FX on Phoenix 6.",
    links: [
      { label: "REV Robotics docs", href: "https://docs.revrobotics.com/", primary: true },
      { label: "REVLib", href: "https://docs.revrobotics.com/revlib" },
      { label: "CTRE Phoenix 6 docs", href: "https://v6.docs.ctr-electronics.com/" },
    ],
  },
  {
    id: "autos",
    track: "programming",
    title: "Autos and field position",
    blurb: "PathPlanner is the path tool most 6925 autos start from. It needs odometry the robot can trust first.",
    links: [
      { label: "PathPlanner docs", href: "https://pathplanner.dev/home.html", primary: true },
      {
        label: "WPILib kinematics and odometry",
        href: "https://docs.wpilib.org/en/stable/docs/software/kinematics-and-odometry/index.html",
      },
    ],
  },
  {
    id: "vision",
    track: "programming",
    title: "Limelight and vision",
    blurb:
      "The camera on the robot. Start with Limelight's own docs — they match the hardware on the cart. PhotonVision is the open-source alternative.",
    links: [
      { label: "Limelight docs", href: "https://docs.limelightvision.io/", primary: true },
      { label: "PhotonVision docs", href: "https://docs.photonvision.org/" },
    ],
  },
  {
    id: "debugging",
    track: "programming",
    title: "Logs and debugging",
    blurb: "When the robot does something odd, the log is the evidence. AdvantageScope opens WPILib logs and live data.",
    links: [
      { label: "AdvantageScope docs", href: "https://docs.advantagescope.org/", primary: true },
      {
        label: "WPILib on-robot logging",
        href: "https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html",
      },
    ],
  },
  {
    id: "github",
    track: "programming",
    title: "GitHub",
    blurb:
      "The Student Developer Pack is free software for students. Use it for private robot-code repos — not a second chat app.",
    links: [
      { label: "GitHub Student Developer Pack", href: "https://education.github.com/pack", primary: true },
      { label: "GitHub Docs — Git basics", href: "https://docs.github.com/en/get-started/using-git" },
    ],
  },

  // ── Mechanical ─────────────────────────────────────────────────────────
  {
    id: "cad",
    track: "mechanical",
    title: "CAD in Onshape",
    blurb:
      "Every part on the robot is modeled in Onshape before it is cut. Learn CAD walks you through it and grades a real part from your Onshape account.",
    links: [
      { label: "Learn CAD", href: "/cad-learn", primary: true },
      { label: "Onshape Learning Center", href: "https://learn.onshape.com/" },
      {
        label: "CAD Video Tutor beginner set",
        href: "https://www.cadvideotutor.com/project-set/introduction-to-feature-based-modeling",
      },
    ],
  },
  {
    id: "design",
    track: "mechanical",
    title: "Robot design",
    blurb:
      "FRCDesign.org teaches FRC robot design in Onshape the way strong teams actually do it — stock sizes, bearings, gearboxes and mechanisms.",
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
      "Do the math before you cut: ReCalc sizes belts, chains, gears, arms, elevators and flywheels, and the in-app gearbox calculator checks a ratio.",
    links: [
      { label: "ReCalc", href: "https://www.reca.lc/", primary: true },
      { label: "Gearbox calculator", href: "/gearbox" },
    ],
  },
  {
    id: "parts",
    track: "mechanical",
    title: "Parts vendors",
    blurb:
      "Where the tube, shaft, bearings and gears come from. Vendor docs list the real dimensions — design to those, not to a guess.",
    links: [
      { label: "WCP docs", href: "https://docs.wcproducts.com/welcome", primary: true },
      { label: "West Coast Products", href: "https://wcproducts.com/" },
      { label: "AndyMark", href: "https://andymark.com/" },
      { label: "REV ION build system", href: "https://docs.revrobotics.com/ion-build" },
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

export const TEAM_6925_WEEKS: PacedWeek[] = [
  // ── Programming ────────────────────────────────────────────────────────
  {
    id: "prog-1",
    track: "programming",
    week: 1,
    title: "Laptop and first deploy",
    why: "Nothing else works until WPILib runs on your machine and you can push code to a roboRIO. Every later week assumes this one is done.",
    steps: [
      "Run the setup command above, or follow Zero to Robot step 2 if you are not on Windows.",
      "Install the FRC Game Tools so you have the Driver Station.",
      "Open WPILib VS Code (the one the installer made, not a separate copy) and create a new project from an example.",
      "Connect to a roboRIO you are allowed to use and run “WPILib: Deploy Robot Code”.",
      "Enable in the Driver Station and watch the log for “Robot program starting”.",
    ],
    verify: "The Driver Station shows green Communications and Robot Code lights for your deploy. A build that never reached the roboRIO does not count.",
    minutes: 120,
    links: [
      {
        label: "Zero to Robot",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/introduction.html",
        primary: true,
      },
      {
        label: "Deploying robot code",
        href: "https://docs.wpilib.org/en/stable/docs/software/vscode-overview/deploying-robot-code.html",
      },
    ],
  },
  {
    id: "prog-2",
    track: "programming",
    week: 2,
    title: "Git, branches and pull requests",
    why: "Code that lives on one laptop disappears the week that person is out sick, and two people editing main at once is how a working robot stops working.",
    steps: [
      "Create a GitHub account with an email you will still have next season, and apply for the Student Developer Pack.",
      "Clone the team repository the lead points you at — do not start a second one.",
      "Make a branch named for what you are doing, e.g. intake-current-limit.",
      "Change one small thing, commit with a message that says what and why, and push the branch.",
      "Open a pull request and ask a lead to review it. Fix what they ask for on the same branch.",
    ],
    verify: "Your pull request is on GitHub with at least one review comment answered, and main was never pushed to directly.",
    minutes: 90,
    links: [
      { label: "GitHub Student Developer Pack", href: "https://education.github.com/pack", primary: true },
      {
        label: "WPILib — Git getting started",
        href: "https://docs.wpilib.org/en/stable/docs/software/basic-programming/git-getting-started.html",
      },
      {
        label: "Creating a pull request",
        href: "https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request",
      },
    ],
  },
  {
    id: "prog-3",
    track: "programming",
    week: 3,
    title: "Java and command-based structure",
    why: "Command-based code splits the robot into subsystems (hardware) and commands (actions). Once you see that split, the team codebase stops looking like one giant file.",
    steps: [
      "Read “What is command-based programming?” and the Subsystems and Commands pages.",
      "In the team repo, find one subsystem and list which motors and sensors it owns.",
      "Find where RobotContainer binds a controller button to a command with a Trigger.",
      "On your branch, add a command that runs a motor while a button is held and stops when released.",
    ],
    verify: "Holding the button runs the motor and releasing it stops the motor — on the robot or in simulation — and the change is in a pull request.",
    minutes: 120,
    links: [
      {
        label: "What is command-based?",
        href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/what-is-command-based.html",
        primary: true,
      },
      { label: "Subsystems", href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/subsystems.html" },
      { label: "Commands", href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/commands.html" },
      {
        label: "Binding commands to triggers",
        href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/binding-commands-to-triggers.html",
      },
    ],
  },
  {
    id: "prog-4",
    track: "programming",
    week: 4,
    title: "Motor controllers: SPARK and Talon FX",
    why: "Most “the code is broken” bugs in build season are a wrong CAN ID, a missing current limit or a flipped inversion. Setting a controller up right is cheaper than a burned motor.",
    steps: [
      "Give every device on the CAN bus a unique ID with REV Hardware Client (SPARK) or Phoenix Tuner X (Talon FX), and write the IDs in the team's wiring sheet.",
      "Set a current limit on every motor in code — NEO 550s and small mechanisms burn out fast without one.",
      "Choose brake mode for arms and elevators and coast mode for flywheels, and say why in a comment.",
      "Check inversion: command a small positive output and confirm the mechanism moves the way the team calls positive.",
      "Apply the configuration in code (SPARK config object or Phoenix 6 TalonFXConfiguration) so a swapped controller gets the same settings.",
    ],
    verify: "The wiring sheet lists every CAN ID, and every motor in the code has a current limit, idle mode and inversion set in one config block.",
    minutes: 120,
    links: [
      { label: "SPARK MAX getting started", href: "https://docs.revrobotics.com/brushless/spark-max/gs", primary: true },
      { label: "SPARK Flex overview", href: "https://docs.revrobotics.com/brushless/spark-flex/overview" },
      { label: "REV Hardware Client", href: "https://docs.revrobotics.com/rev-hardware-client" },
      {
        label: "Phoenix 6 configuration",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/configuration.html",
      },
      { label: "Phoenix Tuner X", href: "https://v6.docs.ctr-electronics.com/en/stable/docs/tuner/index.html" },
      {
        label: "WPILib CAN addressing",
        href: "https://docs.wpilib.org/en/stable/docs/software/can-devices/can-addressing.html",
      },
    ],
  },
  {
    id: "prog-5",
    track: "programming",
    week: 5,
    title: "Sensors and closed-loop control",
    why: "Open-loop “run at 50% for a second” changes with battery voltage. Feedforward plus PID on an encoder is what makes an arm land at the same angle every match.",
    steps: [
      "Read an encoder in code and put its position and velocity on the dashboard. Move the mechanism by hand and check the sign and units.",
      "Read the WPILib introductions to PID and feedforward.",
      "Run SysId on one mechanism to measure kS, kV and kA (and kG for an arm or elevator).",
      "Use those gains with a feedforward and a small kP, then tune kP up until it settles without oscillating.",
    ],
    verify: "A plot shows the mechanism reaching a setpoint and settling, and the gains in code match the SysId result you saved.",
    minutes: 150,
    links: [
      {
        label: "Controls introduction",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/introduction/index.html",
        primary: true,
      },
      {
        label: "Introduction to PID",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/introduction/introduction-to-pid.html",
      },
      {
        label: "Introduction to feedforward",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/introduction/introduction-to-feedforward.html",
      },
      {
        label: "System identification (SysId)",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/system-identification/index.html",
      },
      {
        label: "Encoders in software",
        href: "https://docs.wpilib.org/en/stable/docs/software/hardware-apis/sensors/encoders-software.html",
      },
    ],
  },
  {
    id: "prog-6",
    track: "programming",
    week: 6,
    title: "Swerve kinematics and odometry",
    why: "Autos, vision and field-relative driving all depend on the robot knowing where it is. Odometry that drifts a foot per lap will ruin every path you draw next week.",
    steps: [
      "Read the swerve kinematics page and find where the team code builds SwerveDriveKinematics from the module positions.",
      "Check the module locations in code against the real robot with a tape measure.",
      "Show the odometry pose on the dashboard or AdvantageScope's field view.",
      "Push the robot a measured 3 m straight, then compare what odometry reports.",
    ],
    verify: "After a measured 3 m push, odometry reads within 10 cm, and you wrote down the measured and reported numbers.",
    minutes: 120,
    links: [
      {
        label: "Swerve drive kinematics",
        href: "https://docs.wpilib.org/en/stable/docs/software/kinematics-and-odometry/swerve-drive-kinematics.html",
        primary: true,
      },
      {
        label: "Swerve drive odometry",
        href: "https://docs.wpilib.org/en/stable/docs/software/kinematics-and-odometry/swerve-drive-odometry.html",
      },
      {
        label: "Pose estimators",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/state-space/state-space-pose-estimators.html",
      },
    ],
  },
  {
    id: "prog-7",
    track: "programming",
    week: 7,
    title: "Autonomous with PathPlanner AutoBuilder",
    why: "Autos fail in the first event when nobody practiced a path on real carpet. AutoBuilder ties PathPlanner paths to the drivetrain and the team's named commands.",
    steps: [
      "Read PathPlanner's getting-started page and find where the team configures AutoBuilder.",
      "Register the commands an auto needs (for example “intake”, “score”) as named commands before autos are built.",
      "Draw one simple auto in the PathPlanner app in the team project — do not start a second project.",
      "Pick it from the auto chooser and run it on the practice field or a taped outline. Log whether it finished and where it ended.",
    ],
    verify: "The robot runs the named auto from the chooser three times in a row and ends within a hand's width of the planned end point.",
    minutes: 150,
    links: [
      { label: "Build an auto", href: "https://pathplanner.dev/pplib-build-an-auto.html", primary: true },
      { label: "PathPlanner getting started", href: "https://pathplanner.dev/pplib-getting-started.html" },
    ],
  },
  {
    id: "prog-8",
    track: "programming",
    week: 8,
    title: "Vision and pose estimation",
    why: "Odometry drifts after contact. AprilTag pose estimates pull the robot back to where it really is, which is what makes auto-aim and late-match autos work.",
    steps: [
      "Power the Limelight on the bench, open its web page and confirm a live image before touching code.",
      "Read the MegaTag2 page. Send the gyro heading to the Limelight every loop, as it describes.",
      "Add the MegaTag2 pose to the drivetrain's pose estimator with its timestamp.",
      "Skip the measurement when no tags are seen or the robot is spinning fast, and log how many you accepted.",
    ],
    verify: "In AdvantageScope the vision pose and the estimated pose line up while the robot drives past a tag, and rejected measurements are counted in the log.",
    minutes: 150,
    links: [
      {
        label: "Limelight MegaTag2",
        href: "https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2",
        primary: true,
      },
      {
        label: "Limelight getting started",
        href: "https://docs.limelightvision.io/docs/docs-limelight/getting-started/summary",
      },
      {
        label: "PhotonVision pose estimator",
        href: "https://docs.photonvision.org/en/latest/docs/programming/photonlib/robot-pose-estimator.html",
      },
    ],
  },
  {
    id: "prog-9",
    track: "programming",
    week: 9,
    title: "Logging, simulation and debugging",
    why: "At an event you get about ten minutes between matches. Knowing how to open the log and find the moment it broke is the difference between a fix and a guess.",
    steps: [
      "Start on-robot logging with DataLogManager and confirm a .wpilog file appears after a run.",
      "Open that log in AdvantageScope and plot one motor's output, current and position.",
      "Open the Driver Station Log Viewer and find brownouts or lost-communication events from a practice match.",
      "Run the robot code in WPILib simulation and drive one subsystem without hardware.",
    ],
    verify: "You can show a lead one plot from a real log and name the timestamp where something went wrong (or say that nothing did).",
    minutes: 120,
    links: [
      { label: "AdvantageScope docs", href: "https://docs.advantagescope.org/", primary: true },
      {
        label: "WPILib on-robot logging",
        href: "https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html",
      },
      {
        label: "Driver Station Log Viewer",
        href: "https://docs.wpilib.org/en/stable/docs/software/driverstation/driver-station-log-viewer.html",
      },
      {
        label: "Robot simulation",
        href: "https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/introduction.html",
      },
    ],
  },
  {
    id: "prog-10",
    track: "programming",
    week: 10,
    title: "Competition-ready code",
    why: "The worst bugs at events come from untested pit changes. A tagged build and a checklist mean you always know what is on the robot and can roll back in one deploy.",
    steps: [
      "Before the event, merge to main, deploy, and tag that exact commit (for example 2026-week1-event).",
      "Write a pre-match checklist: battery voltage, correct auto selected, cameras connected, no CAN faults.",
      "Agree on a rule: nothing is deployed in the pits unless it was tested on the practice field or in simulation first.",
      "Practice a rollback: check out the tag and redeploy it in under five minutes.",
    ],
    verify: "The event tag exists on GitHub, the checklist is printed in the pit, and you timed a rollback to the tag.",
    minutes: 90,
    links: [
      { label: "Git tagging", href: "https://git-scm.com/book/en/v2/Git-Basics-Tagging", primary: true },
      {
        label: "GitHub releases",
        href: "https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases",
      },
    ],
  },

  // ── Mechanical ─────────────────────────────────────────────────────────
  {
    id: "mech-1",
    track: "mechanical",
    week: 1,
    title: "Shop safety and tool basics",
    why: "Nobody touches a drill press or chop saw until they have been shown it. Safety glasses on, hair tied back, no loose sleeves — every time, not just when a mentor is watching.",
    steps: [
      "Read the safety rules in this season's game manual and the team's shop rules.",
      "Get signed off by a mentor on each tool you will use: drill and drill press, band saw, hand tools, rivet gun.",
      "Learn where the first-aid kit, fire extinguisher and eyewash are in the shop.",
      "Log any near-miss or injury in the safety log the same day, even a small one.",
    ],
    verify: "A mentor has signed you off on at least three tools, and you can point to the first-aid kit and extinguisher without looking.",
    minutes: 90,
    links: [
      {
        label: "FIRST season materials",
        href: "https://www.firstinspires.org/resources/library/frc/season-materials",
        primary: true,
      },
      { label: "Safety log", href: "/safety" },
    ],
  },
  {
    id: "mech-2",
    track: "mechanical",
    week: 2,
    title: "Onshape fundamentals",
    why: "If it is not in CAD, nobody else can build it, check it fits, or fix it at an event. Sketches, extrudes, part studios and mates are the whole foundation.",
    steps: [
      "Create a free Onshape education account and work through Learn CAD.",
      "Model the CAD Video Tutor Saddle Bracket on cast iron.",
      "Confirm the part appears under Explore Onshape with a last-edited time.",
      "Submit it to the grader only after a lead has bound the reference part.",
    ],
    verify:
      "The grader reports mass and spin against the reference, or it says it graded nothing. Either sentence is honest; a typed number is not.",
    minutes: 150,
    links: [
      { label: "Learn CAD", href: "/cad-learn", primary: true },
      { label: "Onshape Learning Center", href: "https://learn.onshape.com/" },
      {
        label: "CAD Video Tutor beginner set",
        href: "https://www.cadvideotutor.com/project-set/introduction-to-feature-based-modeling",
      },
    ],
  },
  {
    id: "mech-3",
    track: "mechanical",
    week: 3,
    title: "Stock, materials and fasteners",
    why: "Robots are mostly aluminum tube, plate, hex shaft and bolts. Designing to stock sizes you can actually buy is what lets a part go from CAD to the robot in a day.",
    steps: [
      "Learn the common stock: 1x1 and 2x1 aluminum tube, 1/8\" and 1/4\" plate, polycarbonate, 1/2\" and 3/8\" hex shaft.",
      "Learn the common fasteners: 10-32 and 1/4-20 bolts, nylock nuts, and blind rivets.",
      "Use medium (blue) thread-locker on bolts into metal — never on polycarbonate, it cracks it.",
      "Find the bearing and hex-shaft parts in a vendor's docs and add one to an Onshape assembly.",
    ],
    verify: "You can name the stock, fastener and bearing for one real joint on last year's robot, and it matches what is actually there.",
    minutes: 90,
    links: [
      { label: "FRCDesign.org learning course", href: "https://www.frcdesign.org/learning-course/", primary: true },
      { label: "WCP docs", href: "https://docs.wcproducts.com/welcome" },
      { label: "REV ION build system", href: "https://docs.revrobotics.com/ion-build" },
    ],
  },
  {
    id: "mech-4",
    track: "mechanical",
    week: 4,
    title: "Power transmission: gears, belts and chain",
    why: "A motor spins fast with little torque. The ratio decides whether a mechanism is quick, strong or stalls — and a wrong center distance means a belt that skips or chain that falls off.",
    steps: [
      "Work out the total reduction of an existing gearbox by multiplying each stage's driven/driving teeth.",
      "Check that ratio with the in-app gearbox calculator.",
      "Use ReCalc to pick a belt (or chain) length and exact center distance for two pulleys.",
      "Model that center distance in Onshape and add a way to tension it if ReCalc says it is between sizes.",
    ],
    verify: "Your hand-calculated ratio matches the calculator, and the center distance in your CAD matches ReCalc's output.",
    minutes: 120,
    links: [
      { label: "ReCalc", href: "https://www.reca.lc/", primary: true },
      { label: "Gearbox calculator", href: "/gearbox" },
      { label: "ReCalc belts", href: "https://www.reca.lc/belts" },
      { label: "ReCalc chains", href: "https://www.reca.lc/chains" },
      { label: "ReCalc gears", href: "https://www.reca.lc/gears" },
    ],
  },
  {
    id: "mech-5",
    track: "mechanical",
    week: 5,
    title: "Shop drawings and design for manufacturing",
    why: "The person at the band saw should not need to open CAD. A drawing with the right dimensions and hole callouts is what turns your model into a part that fits.",
    steps: [
      "Finish the drawings lesson in Learn CAD.",
      "Make a drawing of one plate: overall size, every hole with a callout (size and count), and material.",
      "Dimension from one edge (a datum) so errors do not add up, and note which dimensions are tight.",
      "Hand the drawing to someone else and have them mark it out on stock without asking you anything.",
    ],
    verify: "Someone else laid out the part from your drawing alone, and every hole landed where the CAD says.",
    minutes: 120,
    links: [
      { label: "Learn CAD — drawings", href: "/cad-learn#drawings", primary: true },
      { label: "Onshape help — drawings", href: "https://cad.onshape.com/help/Content/Drawing/drawings.htm" },
    ],
  },
  {
    id: "mech-6",
    track: "mechanical",
    week: 6,
    title: "Mechanisms: intakes, elevators, arms and shooters",
    why: "Most game pieces are handled by a few proven patterns. Knowing how each one usually fails — bent shafts, slack belts, backlash, binding — saves weeks of redesign.",
    steps: [
      "Pick one mechanism type and find two examples on FRCDesign.org.",
      "List its common failure modes (for example: elevator binding, arm backlash, intake roller slip).",
      "Use the matching ReCalc tool (arm, linear or flywheel) to size the motor and ratio for it.",
      "Write one paragraph on how you would stop it hitting its limits: hard stops, soft limits or both.",
    ],
    verify: "Your mechanism has a ReCalc sizing saved with the motor, ratio and expected speed, and a lead has read your failure-mode list.",
    minutes: 150,
    links: [
      { label: "FRCDesign.org resources", href: "https://www.frcdesign.org/resources/", primary: true },
      { label: "ReCalc arm", href: "https://www.reca.lc/arm" },
      { label: "ReCalc linear (elevator)", href: "https://www.reca.lc/linear" },
      { label: "ReCalc flywheel", href: "https://www.reca.lc/flywheel" },
    ],
  },
  {
    id: "mech-7",
    track: "mechanical",
    week: 7,
    title: "Prototyping fast",
    why: "A cardboard-and-wood prototype built in an afternoon answers questions CAD cannot — how much compression a game piece needs, what roller speed works — before you cut aluminum.",
    steps: [
      "Write the one question the prototype must answer (for example “does 1/2 inch of compression grab the piece?”).",
      "Build it from cardboard, wood or polycarbonate with a drill as the motor.",
      "Measure what worked — distances, compression, speeds — before anyone opens CAD.",
      "Record the result and the decision it led to in the prototype tracker.",
    ],
    verify: "The prototype tracker has an entry with the question, the measured numbers and the decision, plus a photo or video.",
    minutes: 120,
    links: [
      { label: "Prototype tracker", href: "/prototype-tracker", primary: true },
      { label: "FRCDesign.org learning course", href: "https://www.frcdesign.org/learning-course/" },
    ],
  },
  {
    id: "mech-8",
    track: "mechanical",
    week: 8,
    title: "Weight budget, rules and inspection",
    why: "Robots fail inspection for weight, frame perimeter and bumpers far more than for anything clever. Tracking weight from day one beats drilling lightening holes at 2 a.m.",
    steps: [
      "Read this season's robot rules in the game manual: weight limit, frame perimeter, height and bumpers.",
      "Put every subsystem's estimated weight into the weight budget and update it with scale weights as parts are built.",
      "Walk the inspection checklist against the current robot and list what fails.",
    ],
    verify: "The weight budget has a scale weight for every built subsystem, and the inspection checklist has no unchecked item without an owner.",
    minutes: 90,
    links: [
      {
        label: "FIRST season materials (game manual)",
        href: "https://www.firstinspires.org/resources/library/frc/season-materials",
        primary: true,
      },
      { label: "Weight budget", href: "/weight-budget" },
      { label: "Robot inspection checklist", href: "/inspection" },
    ],
  },
  {
    id: "mech-9",
    track: "mechanical",
    week: 9,
    title: "Wiring, maintenance and pit repair",
    why: "Between matches you have minutes, not hours. Tidy wiring, a maintenance routine and a pit repair plan keep a small problem from becoming a dead robot on the field.",
    steps: [
      "Read WPILib's wiring best practices and check the robot: strain relief, no loose connectors, labeled CAN and power.",
      "Write a between-match check: bolts on high-load joints, belt and chain tension, bumpers, battery strap.",
      "Learn how to check battery health and label batteries so the worst one is not used in an elimination match.",
      "Practice one repair against the clock using the pit repair triage page.",
    ],
    verify: "The between-match checklist is printed in the pit, and you timed one repair from “it broke” to “robot ready”.",
    minutes: 90,
    links: [
      {
        label: "Wiring best practices",
        href: "https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/wiring-best-practices.html",
        primary: true,
      },
      {
        label: "Robot battery basics",
        href: "https://docs.wpilib.org/en/stable/docs/hardware/hardware-basics/robot-battery.html",
      },
      { label: "Pit repair triage", href: "/pit-repair-triage" },
    ],
  },
];

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
    ...TEAM_6925_WEEKS.flatMap((week) => week.links),
  ];
}

export function totalLabMinutes(): number {
  return TEAM_6925_WEEKS.reduce((sum, week) => sum + week.minutes, 0);
}
