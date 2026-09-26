/**
 * Team 6925 programming, week by week: from a new laptop to competition code in the team's own
 * stack (WPILib Java command-based, CTRE Phoenix 6 on a CANivore, the Tuner X generated swerve,
 * PathPlannerLib, Limelight MegaTag2, Phoenix signal logs). What each week says about the team's
 * code was read from the 2026 repository; see the notes at the top of frc6925.ts.
 *
 * Every step is checked before it counts. Where a step's id matches an old week id (prog-1 …
 * prog-10) it is the step whose check matches that week's old check, so progress students already
 * earned still shows.
 */

import { nonZeroCall } from "../guided/checks-6925";
import type { PacedWeek } from "./frc6925";
import {
  BUILD_FAILED,
  DEPLOY_RULES,
  PROGRAM_STARTED_RULE,
  TEAM_6925_REPO,
  TEAM_6925_SETUP_COMMAND,
  leadSignoff,
  repoFile,
} from "./frc6925-steps";

const PHOENIX5 = {
  pattern: String.raw`WPI_TalonFX|com\.ctre\.phoenix\.motorcontrol|\bconfigSupplyCurrentLimit\s*\(|\bsetNeutralMode\s*\(\s*NeutralMode\.|\bControlMode\.`,
  found: "that is Phoenix 5 code. The team's robot uses Phoenix 6: TalonFXConfiguration, NeutralModeValue, InvertedValue and control requests such as VelocityVoltage.",
};

const DRIVE_GAINS = String.raw`driveGains\s*=\s*new\s+Slot0Configs\s*\(\s*\)[^;]*`;

export const TEAM_6925_PROGRAMMING_WEEKS: PacedWeek[] = [
  // ── Week 1 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-1",
    track: "programming",
    week: 1,
    title: "New laptop to a first deploy",
    why: "Nothing else works until WPILib runs on your laptop, the team's code builds there, and you can put it on the robot. Every later week assumes this one is done.",
    doneWhen: "Your laptop builds the team's code, and your deploy reached the 6925 roboRIO and started the robot program.",
    minutes: 180,
    links: [
      {
        label: "WPILib installation guide",
        href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/wpilib-setup.html",
        primary: true,
      },
      {
        label: "Deploying robot code",
        href: "https://docs.wpilib.org/en/stable/docs/software/vscode-overview/deploying-robot-code.html",
      },
    ],
    tasks: [
      {
        id: "prog-1-tools",
        title: "Install the tools with one command",
        why: "WPILib 2026 brings its own VS Code and Java, and Git plus the GitHub CLI are how code reaches the team. The setup command installs or updates all of it and signs you in to GitHub.",
        do: [
          "Open PowerShell (Start menu, type PowerShell).",
          `Paste this and press Enter: ${TEAM_6925_SETUP_COMMAND} (it is about 2.5 GB, so use home Wi-Fi).`,
          "When it asks, sign in to GitHub in the browser window it opens.",
          "Close PowerShell, open a new window, and run: git --version, then gh --version, then gh auth status.",
        ],
        checkedBy: "Paste what those three commands printed. Vantage looks for Git's version, the GitHub CLI's version and a signed-in GitHub account.",
        check: {
          kind: "paste",
          prompt: "What git --version, gh --version and gh auth status printed",
          must: [
            { pattern: String.raw`git version \d+\.\d+`, missing: "no “git version …” line. Run git --version in a new PowerShell window." },
            { pattern: String.raw`gh version \d+\.\d+`, missing: "no “gh version …” line. Run gh --version in a new PowerShell window." },
            { pattern: String.raw`Logged in to github\.com`, missing: "gh auth status does not say “Logged in to github.com”. Run gh auth login, then gh auth status again." },
          ],
          verify: {
            reads: "output",
            mustNot: [
              {
                pattern: String.raw`is not recognized as (the name of )?a cmdlet|command not found`,
                found: "PowerShell could not find one of the commands. Close every PowerShell window, open a new one so it sees the new installs, and run them again.",
              },
            ],
          },
        },
        links: [{ label: "WPILib installation guide", href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/wpilib-setup.html" }],
      },
      {
        id: "prog-1-clone",
        title: "Get the team's robot code",
        why: "Everyone works from one repository on GitHub. For 2026 that is 6925-Rebuilt, the repository the team linked from its Open Alliance build thread; most work happened on its sotm-testing branch.",
        do: [
          "Ask a programming lead which repository and branch this season uses. In 2026 it is github.com/JonathanV0/6925-Rebuilt on the sotm-testing branch.",
          "In PowerShell, go to your Documents folder (cd ~/Documents), then run gh repo clone JonathanV0/6925-Rebuilt, or the repository your lead named.",
          "Open WPILib VS Code 2026 (the desktop icon the installer made, not a separate VS Code), then File, Open Folder, and pick the cloned folder.",
          "In VS Code's terminal run git remote -v, then git status.",
        ],
        checkedBy: "Paste what git remote -v and git status printed. Vantage looks for a GitHub remote and the branch you are on.",
        check: {
          kind: "paste",
          prompt: "What git remote -v and git status printed",
          must: [
            {
              pattern: String.raw`github\.com[:/][\w.-]+/[\w.-]+\s+\(fetch\)`,
              missing: "git remote -v shows no GitHub remote. Run it inside the folder gh repo clone made.",
            },
            { pattern: String.raw`On branch \S+`, missing: "git status does not name a branch. Run it inside the cloned folder." },
          ],
          verify: {
            reads: "output",
            mustNot: [
              {
                pattern: "not a git repository",
                found: "Git says this folder is not a repository. cd into the folder gh repo clone made, then run the commands again.",
              },
            ],
          },
        },
        links: [
          { label: "2026 robot code", href: TEAM_6925_REPO },
          {
            label: "WPILib: Git getting started",
            href: "https://docs.wpilib.org/en/stable/docs/software/basic-programming/git-getting-started.html",
          },
        ],
      },
      {
        id: "prog-1-vendordeps",
        title: "Check the vendor libraries are for this season",
        why: "The code depends on CTRE Phoenix 6 (motors, swerve, CANivore) and PathPlannerLib (autos). Each library file names the season it was built for, and a last-season file in this season's project will not build.",
        do: [
          "In VS Code open the vendordeps folder. In 2026 it holds Phoenix6-26.1.1.json, PathplannerLib-2026.1.2.json and WPILibNewCommands.json.",
          "Open the Phoenix 6 file and copy all of it, or copy its address from github.com.",
          "If a lead asks you to update a library, use WPILib: Manage Vendor Libraries, then Check for updates (online), and build again.",
        ],
        checkedBy: "Paste the Phoenix 6 vendordeps file, or its github.com link. Vantage reads the library's name and checks it is built for the 2026 season or later.",
        check: {
          kind: "paste",
          prompt: "The Phoenix 6 vendordeps file, or its github.com link",
          must: [],
          verify: {
            reads: "vendordep",
            vendordep: { name: String.raw`Phoenix.*v6|Phoenix6`, label: "Phoenix 6", minFrcYear: 2026 },
            githubFile: true,
          },
        },
        links: [
          {
            label: "WPILib: third-party libraries",
            href: "https://docs.wpilib.org/en/stable/docs/software/vscode-overview/3rd-party-libraries.html",
          },
          {
            label: "Installing Phoenix 6",
            href: "https://v6.docs.ctr-electronics.com/en/stable/docs/installation/installation-frc.html",
          },
        ],
      },
      {
        id: "prog-1-build",
        title: "Build the code on your laptop",
        why: "A build compiles every file and downloads the libraries. If it fails on your laptop it will fail on the robot, and you find out without a robot in the room.",
        do: [
          "In VS Code press Ctrl+Shift+P, type WPILib: Build Robot Code, and press Enter.",
          "The first build downloads libraries and can take a few minutes. Wait for it to finish.",
          "Copy the last ten lines of the output.",
        ],
        checkedBy: "Paste the end of the build output. Vantage looks for BUILD SUCCESSFUL and Gradle's task summary, and refuses BUILD FAILED.",
        check: {
          kind: "paste",
          prompt: "The last lines of the build output",
          must: [
            { pattern: "BUILD SUCCESSFUL", flags: "", missing: "the output does not say BUILD SUCCESSFUL. Build again and copy the last lines." },
            { pattern: String.raw`\d+ actionable tasks?`, missing: "Gradle's summary line (“… actionable tasks …”) is missing. Copy the last ten lines, not only the first." },
          ],
          verify: { reads: "output", mustNot: [BUILD_FAILED] },
        },
      },
      {
        id: "prog-1",
        title: "Deploy to the robot and see it start",
        why: "Deploying copies your build onto the robot's roboRIO. The deploy output names the robot it reached, so a build that never got there cannot pass this step.",
        do: [
          "Only with a lead in the room: robot on blocks so the wheels are off the floor, and the stop button in reach.",
          "Connect to the robot with a USB cable, an Ethernet tether or the robot's Wi-Fi.",
          "Open the FRC Driver Station, check it says team 6925, and wait for the Communications light to turn green.",
          "Run WPILib: Deploy Robot Code. Copy the output from “Discovering Target roborio” down to BUILD SUCCESSFUL.",
          "In the Driver Station console, copy the line that says the robot program started, and paste it after the deploy output.",
        ],
        checkedBy:
          "Paste the deploy output, then the console line. Vantage checks the deploy reached a 6925 roboRIO (roborio-6925-frc, 10.69.25.2 or USB), finished with BUILD SUCCESSFUL, and that the robot program started.",
        check: {
          kind: "paste",
          prompt: "Deploy output, then the Driver Station console line",
          must: [...DEPLOY_RULES, PROGRAM_STARTED_RULE],
          verify: { reads: "output", mustNot: [BUILD_FAILED] },
        },
        links: [
          {
            label: "Deploying robot code",
            href: "https://docs.wpilib.org/en/stable/docs/software/vscode-overview/deploying-robot-code.html",
          },
          {
            label: "FRC Game Tools (Driver Station)",
            href: "https://docs.wpilib.org/en/stable/docs/zero-to-robot/step-2/frc-game-tools.html",
          },
        ],
      },
    ],
  },

  // ── Week 2 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-2",
    track: "programming",
    week: 2,
    title: "Git and pull requests",
    why: "In 2026 most changes were committed straight to the shared branch. A branch of your own and a pull request mean every change is seen before it reaches the robot, and nobody's half-finished work breaks a deploy.",
    doneWhen: "You made a change on your own branch, pushed it, and your pull request has a review you answered.",
    minutes: 90,
    links: [
      {
        label: "WPILib: Git getting started",
        href: "https://docs.wpilib.org/en/stable/docs/software/basic-programming/git-getting-started.html",
        primary: true,
      },
      {
        label: "Creating a pull request",
        href: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request",
      },
      { label: "GitHub Student Developer Pack", href: "https://education.github.com/pack" },
    ],
    tasks: [
      {
        id: "prog-2-branch",
        title: "Start a branch of your own",
        why: "Your own branch keeps your work apart from the branch the robot runs. You can break it, fix it and try again without stopping anyone.",
        do: [
          "git switch sotm-testing (or the branch your lead named), then git pull.",
          "git switch -c yourname/what-you-are-doing, for example alex/feeder-comment.",
          "Run git status.",
        ],
        checkedBy: "Paste what git status printed. Vantage checks you are on a branch of your own, not main, master or sotm-testing.",
        check: {
          kind: "paste",
          prompt: "What git status printed",
          must: [{ pattern: String.raw`On branch \S+`, missing: "git status does not name a branch. Run it inside the robot code folder." }],
          verify: {
            reads: "output",
            mustNot: [
              {
                pattern: String.raw`On branch (main|master|sotm-testing)\s*$`,
                flags: "im",
                found: "you are still on the shared branch. Make your own with git switch -c yourname/what-you-are-doing, then run git status again.",
              },
            ],
          },
        },
      },
      {
        id: "prog-2-commit",
        title: "Commit one small change and push it",
        why: "Small commits with clear messages are how the team finds the change that broke something. Pushing puts your branch on GitHub so others can see it.",
        do: [
          "Make one small, useful change. A good first one: the header comment in RobotContainer.java says the shooter is limited to 120 A stator, but CTREConfigs.java sets 90 A. Fix the comment to match the code.",
          "git add the file, then git commit -m \"Say what changed and why\".",
          "git push -u origin yourname/what-you-are-doing",
          "Run git log --oneline -3.",
        ],
        checkedBy: "Paste what git push and git log printed. Vantage looks for your pushed branch and your commit, and refuses a rejected push.",
        check: {
          kind: "paste",
          prompt: "What git push and git log --oneline -3 printed",
          must: [
            {
              pattern: String.raw`\[new branch\]|^\s*[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s+\S+\s+->\s+\S+`,
              flags: "m",
              missing: "no push output. Run git push -u origin <your branch> and paste what it printed.",
            },
            { pattern: String.raw`^[0-9a-f]{7,40} \S`, flags: "m", missing: "no commit lines. Run git log --oneline -3 and paste them." },
          ],
          verify: {
            reads: "output",
            mustNot: [
              { pattern: String.raw`\[rejected\]|error: failed to push`, found: "the push was rejected. Run git pull on your branch, fix any conflict, and push again." },
              { pattern: String.raw`^fatal:`, flags: "m", found: "Git stopped with an error (fatal). Read it, fix it or ask a lead, and try again." },
            ],
          },
        },
        links: [{ label: "RobotContainer.java (2026)", href: repoFile("src/main/java/frc/robot/RobotContainer.java") }],
      },
      {
        id: "prog-2",
        title: "Open a pull request and answer a review",
        why: "A pull request shows the change line by line before it is merged. A lead's review catches the mistake you cannot see because you wrote it.",
        do: [
          "Run gh pr create --base sotm-testing --fill (or the branch your lead named), or open it on github.com.",
          "Ask a programming lead to review it.",
          "Answer every comment: fix it on the same branch and push, or reply saying why not.",
          "Paste the pull request's link here.",
        ],
        checkedBy: "Paste the pull request's link. Vantage asks GitHub that it exists and has at least one comment or review.",
        check: { kind: "github-pr", minComments: 1 },
      },
    ],
  },

  // ── Week 3 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-3",
    track: "programming",
    week: 3,
    title: "How the robot code is built",
    why: "Command-based code splits the robot into subsystems (the hardware) and commands (what it does). Once you can find each piece in the team's code, it stops looking like one giant file.",
    doneWhen: "You can name every subsystem, you bound a button to a command, it runs in simulation, and the change is in a pull request.",
    minutes: 150,
    links: [
      {
        label: "Structuring a command-based project",
        href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/structuring-command-based-project.html",
        primary: true,
      },
      { label: "Subsystems", href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/subsystems.html" },
      { label: "Commands", href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/commands.html" },
    ],
    tasks: [
      {
        id: "prog-3-read",
        title: "Find the pieces: Robot, RobotContainer, subsystems",
        why: "In the 2026 code Robot.java runs the command scheduler, RobotContainer builds every subsystem and binds the controllers, and RobotCommands.java holds the commands that use more than one subsystem. Every mechanism motor is a Talon FX on the CANivore bus, named “CANivore” in code.",
        do: [
          "Read WPILib's page on structuring a command-based project.",
          "Open Robot.java and find CommandScheduler.getInstance().run() in robotPeriodic.",
          "Open RobotContainer.java and list its subsystems: the swerve drivetrain from TunerConstants, ShooterSubsys, IntakeSubsys, FeederSubsys, HoodSubsys and LimelightSubsys.",
          "Open ShooterSubsys.java and copy the three lines that create its motors.",
        ],
        checkedBy: "Paste the three motor lines from ShooterSubsys.java. Vantage checks they create three Talon FX motors on the CANivore bus.",
        check: {
          kind: "paste",
          prompt: "The lines in ShooterSubsys.java that create the shooter motors",
          must: [
            {
              pattern: String.raw`(new\s+TalonFX\s*\(\s*\d+\s*,\s*"CANivore"\s*\)[\s\S]*?){3}`,
              missing: "not three motors created with new TalonFX(id, \"CANivore\"). Copy all three lines from ShooterSubsys.java.",
            },
          ],
          verify: { reads: "java", githubFile: true },
        },
        links: [
          { label: "ShooterSubsys.java (2026)", href: repoFile("src/main/java/frc/robot/subsystems/ShooterSubsys.java") },
          { label: "RobotContainer.java (2026)", href: repoFile("src/main/java/frc/robot/RobotContainer.java") },
        ],
      },
      {
        id: "prog-3-bind",
        title: "Bind a button to a command",
        why: "Controllers are wired in configureBindings: the driver's Xbox controller on port 0 and the operator's X3D joystick on port 1 (the team's own CommandX3DController). whileTrue runs a command while a button is held; onTrue runs it once per press.",
        do: [
          "Read WPILib's page on binding commands to triggers.",
          "On your branch, find an operator button with no binding (some lines in configureBindings are commented out).",
          "Bind it with whileTrue to an existing command, for example a feeder or intake command, so it runs only while held.",
          "Build, fix anything the build complains about, and copy your new binding line.",
        ],
        checkedBy: "Paste your binding. Vantage reads it as Java (comments do not count) and looks for a controller button bound with whileTrue, onTrue, onFalse or toggleOnTrue.",
        check: {
          kind: "paste",
          prompt: "Your new binding line (and the lines around it)",
          must: [
            {
              pattern: String.raw`\.(?:button|pov)\s*\(\s*\d+\s*\)\s*\.(?:whileTrue|onTrue|onFalse|toggleOnTrue)\s*\(|\.(?:a|b|x|y|leftBumper|rightBumper|leftTrigger|rightTrigger|povUp|povDown|povLeft|povRight|start|back)\s*\(\s*\)\s*\.(?:whileTrue|onTrue|onFalse|toggleOnTrue)\s*\(`,
              missing: "no button binding. A binding looks like operator.button(3).whileTrue(…).",
            },
          ],
          verify: {
            reads: "java",
            mustNot: [
              {
                pattern: String.raw`new\s+JoystickButton\s*\(`,
                found: "that is the old JoystickButton style. The team's code uses controller triggers: operator.button(n).whileTrue(…).",
              },
            ],
          },
        },
        links: [
          {
            label: "Binding commands to triggers",
            href: "https://docs.wpilib.org/en/stable/docs/software/commandbased/binding-commands-to-triggers.html",
          },
        ],
      },
      {
        id: "prog-3-sim",
        title: "Run it in simulation",
        why: "The drivetrain class starts CTRE's swerve simulation when it runs on a laptop, and the build has desktop simulation turned on, so you can drive the robot code without a robot.",
        do: [
          "Run WPILib: Simulate Robot Code and pick Sim GUI if it asks.",
          "In the Sim GUI, drag a keyboard or controller from System Joysticks onto Joystick 0, set Robot State to Teleoperated, and drive.",
          "Watch the output for red text or the word Exception.",
          "Copy the output from the start through the line saying the robot program started.",
        ],
        checkedBy: "Paste the simulation output. Vantage looks for the simulator loading and the robot program starting, and refuses a Java error from the robot code.",
        check: {
          kind: "paste",
          prompt: "The simulation output",
          must: [
            PROGRAM_STARTED_RULE,
            { pattern: String.raw`simulat|halsim|HAL Extension`, missing: "this does not look like simulation output. Use WPILib: Simulate Robot Code and copy from its output." },
          ],
          verify: {
            reads: "output",
            mustNot: [
              {
                pattern: String.raw`Exception in thread|Unhandled exception|^\s*at frc\.robot\.`,
                flags: "im",
                found: "the robot code threw an error. Find the first line mentioning frc.robot, fix it, and run the simulation again.",
              },
            ],
          },
        },
        links: [
          {
            label: "Robot simulation",
            href: "https://docs.wpilib.org/en/stable/docs/software/wpilib-tools/robot-simulation/introduction.html",
          },
          {
            label: "CTRE swerve simulation",
            href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/mechanisms/swerve/swerve-simulation.html",
          },
        ],
      },
      {
        id: "prog-3",
        title: "Get your binding reviewed",
        why: "A binding decides what a button does in a match. The drive team should hear about it in a pull request, not find out on the field.",
        do: ["Commit and push your binding on your branch.", "Open a pull request and tell the drive team which button does what.", "Paste the pull request's link here."],
        checkedBy: "Paste the pull request's link. Vantage asks GitHub that it exists and that it changes a Java file under src/main/java.",
        check: { kind: "github-pr", changes: { pattern: String.raw`^src/main/java/.+\.java$`, label: "a Java file under src/main/java" } },
      },
    ],
  },

  // ── Week 4 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-4",
    track: "programming",
    week: 4,
    title: "Talon FX motors on Phoenix 6",
    why: "Most “the code is broken” bugs in build season are a wrong CAN ID, a missing current limit or a flipped inversion. Setting a motor up right in code is cheaper than a burned motor.",
    doneWhen: "Every CAN device matches the code, your motor config sets current limits, brake or coast and direction, and a lead watched it move the right way.",
    minutes: 150,
    links: [
      {
        label: "Phoenix 6 configuration",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/configuration.html",
        primary: true,
      },
      { label: "Phoenix Tuner X", href: "https://v6.docs.ctr-electronics.com/en/stable/docs/tuner/index.html" },
      {
        label: "Current limits",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/hardware-reference/talonfx/improving-performance-with-current-limits.html",
      },
      { label: "CANivore", href: "https://v6.docs.ctr-electronics.com/en/stable/docs/canivore/canivore-intro.html" },
    ],
    tasks: [
      {
        id: "prog-4-tuner",
        title: "Find every device in Phoenix Tuner X",
        why: "Every motor, CANcoder and the Pigeon 2 on the 2026 robot is a CTRE device on the CANivore. Tuner X shows each one's ID and firmware; a wrong ID or old firmware is the usual reason a motor does nothing.",
        do: [
          "Robot on, lead present. Connect to the robot, open Phoenix Tuner X and pick the CANivore in the device list.",
          "Check each ID against the code: shooter 8, 9 and 10, fuel feed 11, intake roller 45, intake pivot 50, feeder 51, and the swerve IDs in TunerConstants.java.",
          "Update any device Tuner X marks as out of date.",
          "Write the list in the team's wiring sheet.",
        ],
        ...leadSignoff("Every CAN device on the robot matches an ID in the code, is on current firmware, and is written in the wiring sheet."),
        links: [
          { label: "Phoenix Tuner X", href: "https://v6.docs.ctr-electronics.com/en/stable/docs/tuner/index.html" },
          { label: "TunerConstants.java (2026)", href: repoFile("src/main/java/frc/robot/generated/TunerConstants.java") },
        ],
      },
      {
        id: "prog-4",
        title: "Configure a Talon FX in code",
        why: "The 2026 code keeps each motor's settings in CTREConfigs.java (current limits, brake or coast, which way is positive) and applies them in the subsystem's constructor. Settings in code mean a swapped motor gets them back on the next boot.",
        do: [
          "Read CTRE's configuration page and its current limits page.",
          "Open CTREConfigs.java, pick one config (for example FEEDER_CONFIG) and say out loud what each line does.",
          "On your branch, add or fix one config: a stator and a supply current limit (both enabled), a NeutralModeValue (Brake for pivots, Coast for rollers and flywheels), and an InvertedValue, even when it is the default.",
          "Make sure the subsystem applies it with getConfigurator().apply(...) in its constructor.",
          "Paste the config from CTREConfigs.java and, under it, the apply line from the subsystem.",
        ],
        checkedBy:
          "Paste the config and the apply line. Vantage reads them as Java (comments do not count) and looks for both current limits turned on, a neutral mode, an inversion and the apply call. Phoenix 5 code does not pass.",
        check: {
          kind: "paste",
          prompt: "Your TalonFXConfiguration from CTREConfigs.java, then the line in the subsystem that applies it",
          must: [
            { pattern: String.raw`TalonFXConfiguration`, flags: "", missing: "no TalonFXConfiguration. Phoenix 6 settings go in a TalonFXConfiguration." },
            {
              pattern: String.raw`StatorCurrentLimitEnable\s*=\s*true|withStatorCurrentLimitEnable\s*\(\s*true\s*\)`,
              missing: "the stator current limit is not turned on. Set CurrentLimits.StatorCurrentLimitEnable = true.",
            },
            {
              pattern: String.raw`SupplyCurrentLimitEnable\s*=\s*true|withSupplyCurrentLimitEnable\s*\(\s*true\s*\)`,
              missing: "the supply current limit is not turned on. Set CurrentLimits.SupplyCurrentLimitEnable = true.",
            },
            { pattern: String.raw`NeutralModeValue\.(Brake|Coast)`, flags: "", missing: "no neutral mode. Set MotorOutput.NeutralMode to NeutralModeValue.Brake or Coast." },
            {
              pattern: String.raw`InvertedValue\.(Clockwise_Positive|CounterClockwise_Positive)`,
              flags: "",
              missing: "no inversion. Set MotorOutput.Inverted to an InvertedValue even when it is the default, so it is a decision.",
            },
            { pattern: String.raw`getConfigurator\s*\(\s*\)\s*\.apply\s*\(`, flags: "", missing: "the config is never applied. Call motor.getConfigurator().apply(yourConfig)." },
          ],
          verify: {
            reads: "java",
            mustNot: [
              PHOENIX5,
              {
                pattern: String.raw`CurrentLimitEnable\s*=\s*false|CurrentLimitEnable\s*\(\s*false\s*\)`,
                found: "a current limit is switched off. Leave StatorCurrentLimitEnable and SupplyCurrentLimitEnable true.",
              },
            ],
          },
        },
        links: [
          { label: "CTREConfigs.java (2026)", href: repoFile("src/main/java/frc/robot/CTREConfigs.java") },
          {
            label: "Phoenix 6 configuration",
            href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/configuration.html",
          },
        ],
      },
      {
        id: "prog-4-direction",
        title: "Prove positive is the right way",
        why: "If a motor is inverted wrong, every command for it is backwards, and the fix people reach for (a minus sign everywhere) breaks the next time someone adds a command.",
        do: [
          "Robot on blocks, lead present.",
          "Command a small positive output (5%) from a short test command or from Tuner X's control page.",
          "Watch which way the mechanism moves. The shooter should spin the way that launches a game piece; the intake pivot should move the way IntakeSubsys calls positive.",
          "If it is backwards, change the InvertedValue in CTREConfigs.java, deploy, and try again.",
        ],
        ...leadSignoff("A small positive output moved the mechanism the way the team calls positive, and any fix was made in the InvertedValue, not with minus signs."),
      },
    ],
  },

  // ── Week 5 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-5",
    track: "programming",
    week: 5,
    title: "Closed loop: the flywheel and SysId",
    why: "Open-loop “run at 50%” changes with battery voltage. The shooter holds its speed with a velocity loop on each Talon FX, and the drivetrain's gains should come from measuring the real robot.",
    doneWhen: "The flywheel holds its target speed, and the drive gains in TunerConstants.java come from a SysId run on the real robot.",
    minutes: 180,
    links: [
      {
        label: "Closed-loop requests (Talon FX)",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/device-specific/talonfx/closed-loop-requests.html",
        primary: true,
      },
      {
        label: "Tuning a flywheel",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/introduction/tuning-flywheel.html",
      },
      {
        label: "Introduction to feedforward",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/introduction/introduction-to-feedforward.html",
      },
    ],
    tasks: [
      {
        id: "prog-5-flywheel",
        title: "Hold the flywheel at speed",
        why: "The shooter uses VelocityVoltage: each Talon FX runs its own loop with the Slot0 gains in CTREConfigs.java. If the flywheel sits below its target, shots fall short. The dashboard already shows “Shooter Target RPM” and “Shooter RPM”.",
        do: [
          "Read WPILib's flywheel tuning page and CTRE's closed-loop requests page.",
          "Robot on blocks, no game pieces loaded, lead present, safety glasses on.",
          "Hold a wind-up command for the fixed shot (3350 RPM, kFixedShotRPM in Constants.java) and wait two seconds.",
          "Read Shooter Target RPM and Shooter RPM on the dashboard and type both.",
          "If they are more than 100 RPM apart, tune Slot0 (kV first, then kP) on your branch and measure again.",
        ],
        checkedBy: "Type the target and the measured speed from the dashboard. They must be within 100 RPM.",
        check: {
          kind: "numbers",
          fields: [
            { id: "target", label: "Shooter Target RPM", unit: "RPM" },
            { id: "measured", label: "Shooter RPM after 2 seconds", unit: "RPM" },
          ],
          within: { a: "target", b: "measured", tolerance: 100, unit: "RPM" },
        },
        links: [{ label: "ShooterSubsys.java (2026)", href: repoFile("src/main/java/frc/robot/subsystems/ShooterSubsys.java") }],
      },
      {
        id: "prog-5",
        title: "Measure the drive with SysId",
        why: "TunerConstants.java still has the swerve generator's starting drive gains: kS 0 and kV 0.124. Whenever the drive runs closed-loop on wheel speed it uses these numbers, so they should come from the real robot.",
        do: [
          "Read CTRE's SysId page. The drivetrain already has the SysId routines (sysIdQuasistatic and sysIdDynamic) and logs them with SignalLogger.",
          "On your branch, bind the four tests to spare driver buttons the way CTRE's example does (back or start, with X or Y). Build and deploy.",
          "On a clear floor with a lead: run quasistatic forward and reverse, then dynamic forward and reverse. Stop before the robot reaches anything.",
          "Copy the .hoot log off the robot, turn it into a .wpilog with Tuner X's Log Extractor, and load it in the SysId tool.",
          "Put the kS and kV SysId reports into driveGains in TunerConstants.java. Take the SysId bindings out before you merge.",
        ],
        checkedBy:
          "Paste driveGains from TunerConstants.java, or a github.com link to the file. Vantage checks kS is no longer 0 and kV is no longer the generator's 0.124.",
        check: {
          kind: "paste",
          prompt: "driveGains from TunerConstants.java, or a github.com link to the file",
          must: [
            { pattern: DRIVE_GAINS, flags: "", missing: "no driveGains = new Slot0Configs(). Copy it from TunerConstants.java." },
            { pattern: DRIVE_GAINS + nonZeroCall(String.raw`\.withKS`), flags: "", missing: "driveGains still has kS 0. Put the kS from your SysId result in withKS(…)." },
            { pattern: DRIVE_GAINS + nonZeroCall(String.raw`\.withKV`), flags: "", missing: "driveGains has no kV. Put the kV from your SysId result in withKV(…)." },
          ],
          verify: {
            reads: "java",
            githubFile: true,
            mustNot: [
              {
                pattern: DRIVE_GAINS + String.raw`\.withKV\s*\(\s*0?\.124\s*\)`,
                flags: "",
                found: "kV is still the generator's 0.124. Use the kV from your SysId result.",
              },
            ],
          },
        },
        links: [
          {
            label: "CTRE SysId integration",
            href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/wpilib-integration/sysid-integration/index.html",
          },
          { label: "Tuner X Log Extractor", href: "https://v6.docs.ctr-electronics.com/en/stable/docs/tuner/tools/log-extractor.html" },
          {
            label: "WPILib SysId",
            href: "https://docs.wpilib.org/en/stable/docs/software/advanced-controls/system-identification/index.html",
          },
          { label: "TunerConstants.java (2026)", href: repoFile("src/main/java/frc/robot/generated/TunerConstants.java") },
        ],
      },
    ],
  },

  // ── Week 6 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-6",
    track: "programming",
    week: 6,
    title: "Swerve: the CTRE drivetrain and odometry",
    why: "Autos, vision and field-relative driving all depend on the robot knowing where it is. Odometry that drifts a foot per lap ruins every path you draw next week.",
    doneWhen: "The wheels match the code, the drive state is in the log, and a measured 3 m push reads within 10 cm.",
    minutes: 150,
    links: [
      {
        label: "CTRE swerve overview",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/mechanisms/swerve/swerve-overview.html",
        primary: true,
      },
      {
        label: "Swerve requests",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/mechanisms/swerve/swerve-requests.html",
      },
      {
        label: "WPILib swerve odometry",
        href: "https://docs.wpilib.org/en/stable/docs/software/kinematics-and-odometry/swerve-drive-odometry.html",
      },
    ],
    tasks: [
      {
        id: "prog-6-wheel",
        title: "Measure the wheels",
        why: "Odometry turns motor turns into metres using the wheel radius in TunerConstants.java (2 inches, so 4 inches across). Tread wears during a season, and a worn wheel makes every distance a few percent off.",
        do: [
          "Read kWheelRadius in TunerConstants.java and double it.",
          "With calipers, measure one wheel across the tread in three places and average them.",
          "Type the code's diameter and your measured diameter.",
          "If they differ by more than 0.05 inch, replace the tread or update kWheelRadius, then measure again.",
        ],
        checkedBy: "Type both diameters. They must be within 0.05 inch.",
        check: {
          kind: "numbers",
          fields: [
            { id: "code", label: "diameter in the code", unit: "in" },
            { id: "measured", label: "measured diameter", unit: "in" },
          ],
          within: { a: "code", b: "measured", tolerance: 0.05, unit: "in" },
        },
      },
      {
        id: "prog-6-telemetry",
        title: "Send the drive state to the log",
        why: "Telemetry.java writes the pose, speeds and module states to NetworkTables and the log, but in the 2026 code nothing hands it the drivetrain's state. CTRE's generated project calls drivetrain.registerTelemetry(logger::telemeterize); this code does not.",
        do: [
          "Open RobotContainer.java and search for registerTelemetry. If a lead already added it, copy that line and skip to the last step.",
          "Add drivetrain.registerTelemetry(logger::telemeterize); at the end of configureBindings, as CTRE's SwerveWithPathPlanner example does.",
          "Build, deploy, and open AdvantageScope connected to the robot. Find DriveState/Pose and put it on a 2D field.",
          "Paste the line you added, or a github.com link to RobotContainer.java on your branch.",
        ],
        checkedBy: "Paste the line or the file's github.com link. Vantage reads it as Java (a commented-out line does not count) and looks for registerTelemetry with the telemeterize method.",
        check: {
          kind: "paste",
          prompt: "The registerTelemetry line, or a github.com link to RobotContainer.java",
          must: [
            {
              pattern: String.raw`registerTelemetry\s*\(\s*\w+::telemeterize\s*\)`,
              flags: "",
              missing: "no drivetrain.registerTelemetry(logger::telemeterize). Add it at the end of configureBindings.",
            },
          ],
          verify: { reads: "java", githubFile: true },
        },
        links: [
          { label: "Telemetry.java (2026)", href: repoFile("src/main/java/frc/robot/Telemetry.java") },
          { label: "CTRE's Phoenix 6 examples", href: "https://github.com/CrossTheRoadElec/Phoenix6-Examples" },
        ],
      },
      {
        id: "prog-6",
        title: "Push test: odometry against a tape measure",
        why: "A tape measure is the truth. If odometry disagrees with it by more than a hand's width over 3 m, the wheel size, gear ratio or module positions are wrong.",
        do: [
          "Put the robot on carpet with a tape measure along one side, and mark the front bumper.",
          "Do it where the Limelight cannot see an AprilTag, or cover the lens: while disabled, the 2026 code resets the pose from vision.",
          "Write down the pose X shown for DriveState/Pose, push the robot a measured 3 m straight forward, and write down the new X.",
          "Type the tape distance and the change in X.",
        ],
        checkedBy: "Type the distance you measured with a tape and the distance odometry reported. They must be within 10 cm.",
        check: {
          kind: "numbers",
          fields: [
            { id: "measured", label: "measured distance", unit: "m" },
            { id: "reported", label: "odometry distance", unit: "m" },
          ],
          within: { a: "measured", b: "reported", tolerance: 0.1, unit: "m" },
        },
      },
    ],
  },

  // ── Week 7 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-7",
    track: "programming",
    week: 7,
    title: "Autos with PathPlanner",
    why: "Autos fail at the first event when nobody ran a path on real carpet. The team's autos are PathPlanner files run through AutoBuilder, with robot actions called by name.",
    doneWhen: "PathPlanner knows the real robot's mass, your named command is registered in the right place, your auto is in a pull request, and it ends within 15 cm of the plan.",
    minutes: 180,
    links: [
      { label: "Build an auto", href: "https://pathplanner.dev/pplib-build-an-auto.html", primary: true },
      { label: "Named commands", href: "https://pathplanner.dev/pplib-named-commands.html" },
      { label: "Robot config", href: "https://pathplanner.dev/robot-config.html" },
    ],
    tasks: [
      {
        id: "prog-7-mass",
        title: "Give PathPlanner the real robot",
        why: "PathPlanner's settings (src/main/deploy/pathplanner/settings.json) hold the robot's mass, moment of inertia, wheel grip and motor type, and AutoBuilder loads them with RobotConfig.fromGUISettings(). A robot much heavier than PathPlanner thinks falls behind every path.",
        do: [
          "Weigh the robot the way it plays: bumpers and battery on.",
          "Open the robot code folder in the PathPlanner app, go to Settings, Robot Config, and read Robot Mass (51.48 kg in the 2026 file).",
          "If they differ by more than 2 kg, change the mass in PathPlanner, save, and commit settings.json on your branch.",
          "Type the scale weight and the mass PathPlanner now has, both in kilograms.",
        ],
        checkedBy: "Type both masses. They must be within 2 kg.",
        check: {
          kind: "numbers",
          fields: [
            { id: "scale", label: "robot on the scale", unit: "kg" },
            { id: "pathplanner", label: "PathPlanner robot mass", unit: "kg" },
          ],
          within: { a: "scale", b: "pathplanner", tolerance: 2, unit: "kg" },
        },
      },
      {
        id: "prog-7",
        title: "Register a named command the right way",
        why: "Autos call robot actions by name (the 2026 code registers “shoot”, “IntakeFast”, “AdjustedWindUp” and more). PathPlanner's rule is that named commands must be registered before any auto is created, so every registerCommand has to come before AutoBuilder.buildAutoChooser.",
        do: [
          "Read PathPlanner's named commands page.",
          "In RobotContainer's constructor, add a named command for something an auto needs, above the buildAutoChooser line.",
          "Leave AutoBuilder.configure where it is, in CommandSwerveDrivetrain's configureAutoBuilder.",
          "Paste the constructor from the first registerCommand to buildAutoChooser, or a github.com link to RobotContainer.java.",
        ],
        checkedBy:
          "Paste the code or its github.com link. Vantage reads it as Java and checks a named command is registered and every registerCommand comes before AutoBuilder.buildAutoChooser.",
        check: {
          kind: "paste",
          prompt: "RobotContainer's constructor (registerCommand lines through buildAutoChooser), or a github.com link",
          must: [
            {
              pattern: String.raw`NamedCommands\.registerCommand\s*\(\s*"[^"]+"\s*,`,
              flags: "",
              missing: "no NamedCommands.registerCommand(\"name\", command). Register your command by name.",
            },
            { pattern: String.raw`AutoBuilder\.buildAutoChooser\s*\(`, flags: "", missing: "no AutoBuilder.buildAutoChooser(…). Paste down to the line that builds the chooser." },
          ],
          verify: {
            reads: "java",
            githubFile: true,
            order: [
              {
                first: String.raw`NamedCommands\.registerCommand\s*\(`,
                then: String.raw`AutoBuilder\.buildAutoChooser\s*\(`,
                flags: "",
                wrong: "a named command is registered after buildAutoChooser. Move every registerCommand above it; an auto built before a name exists cannot run that command.",
              },
            ],
          },
        },
        links: [
          { label: "Named commands", href: "https://pathplanner.dev/pplib-named-commands.html" },
          {
            label: "CommandSwerveDrivetrain.java (2026)",
            href: repoFile("src/main/java/frc/robot/subsystems/CommandSwerveDrivetrain.java"),
          },
        ],
      },
      {
        id: "prog-7-auto",
        title: "Draw an auto and put it in a pull request",
        why: "Autos live in the repository next to the code (src/main/deploy/pathplanner), so they are reviewed, versioned and deployed the same way.",
        do: [
          "Open the robot code folder in the PathPlanner app.",
          "Make a new auto, or change a copy of one (M-S is the chooser's default in 2026), and use your named command as an event marker.",
          "Commit the .auto and .path files on your branch and open a pull request.",
        ],
        checkedBy: "Paste the pull request's link. Vantage asks GitHub that it changes a PathPlanner .auto or .path file.",
        check: {
          kind: "github-pr",
          changes: { pattern: String.raw`^src/main/deploy/pathplanner/(autos|paths)/.+\.(auto|path)$`, label: "a PathPlanner auto or path" },
        },
        links: [{ label: "Editing paths and autos", href: "https://pathplanner.dev/gui-editing-paths-and-autos.html" }],
      },
      {
        id: "prog-7-run",
        title: "Run it on carpet and measure where it stops",
        why: "An auto is only done when the real robot ends where the app says. The worst of three runs is the honest number.",
        do: [
          "Tape the start position and place the robot exactly on the auto's starting pose.",
          "Pick your auto in the Auto Chooser, run autonomous, and mark where the robot stops. Do it three times.",
          "For the worst run, measure from the alliance wall (or a taped line) to the robot's center, and read the same distance for the auto's end point in PathPlanner.",
          "Type both.",
        ],
        checkedBy: "Type the planned and measured end distances. They must be within 15 cm.",
        check: {
          kind: "numbers",
          fields: [
            { id: "planned", label: "planned end distance (PathPlanner)", unit: "m" },
            { id: "measured", label: "measured end distance (worst run)", unit: "m" },
          ],
          within: { a: "planned", b: "measured", tolerance: 0.15, unit: "m" },
        },
      },
    ],
  },

  // ── Week 8 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-8",
    track: "programming",
    week: 8,
    title: "Limelight and MegaTag2",
    why: "Odometry drifts after contact. AprilTag pose estimates pull the robot back to where it really is, which is what makes auto-aim and late-match autos work.",
    doneWhen: "The camera sits where the code says, vision skips frames it should not trust, and the change is in a pull request.",
    minutes: 150,
    links: [
      {
        label: "Limelight MegaTag2",
        href: "https://docs.limelightvision.io/docs/docs-limelight/pipeline-apriltag/apriltag-robot-localization-megatag2",
        primary: true,
      },
      { label: "LimelightHelpers", href: "https://docs.limelightvision.io/docs/docs-limelight/apis/limelight-lib" },
      { label: "Limelight getting started", href: "https://docs.limelightvision.io/docs/docs-limelight/getting-started/summary" },
    ],
    tasks: [
      {
        id: "prog-8-camera",
        title: "Check the camera is where the code says",
        why: "LimelightSubsys tells the Limelight where it sits on the robot: 25.39 inches up, 1.46 inches behind center, tilted up 20.37°. If the camera moved and the numbers did not, every vision pose is off.",
        do: [
          "Open the Limelight's web page on the robot network (Limelight's getting-started page shows how) and confirm a live image and the AprilTag pipeline.",
          "With the robot on the floor, measure from the floor to the center of the lens.",
          "Type kCameraHeightInches from LimelightSubsys.java and your measurement.",
          "If they differ by more than half an inch, fix the code (and the forward offset and angle if the mount moved).",
        ],
        checkedBy: "Type the height in the code and the height you measured. They must be within 0.5 inch.",
        check: {
          kind: "numbers",
          fields: [
            { id: "code", label: "camera height in the code", unit: "in" },
            { id: "measured", label: "measured camera height", unit: "in" },
          ],
          within: { a: "code", b: "measured", tolerance: 0.5, unit: "in" },
        },
        links: [{ label: "LimelightSubsys.java (2026)", href: repoFile("src/main/java/frc/robot/subsystems/LimelightSubsys.java") }],
      },
      {
        id: "prog-8",
        title: "Skip vision while the robot spins",
        why: "MegaTag2 needs the robot's heading every loop (SetRobotOrientation) and is only trusted when it sees a tag. The 2026 code does both and trusts far tags less, but it still uses frames while the robot spins fast; Limelight's own example skips them above 360°/s.",
        do: [
          "Read the MegaTag2 page.",
          "Find getMeasurement() in LimelightSubsys.java and updateVision() in RobotContainer.java.",
          "On your branch, skip the measurement when the drivetrain turns faster than 360°/s. drivetrain.getState().Speeds.omegaRadiansPerSecond is in radians per second, so 360°/s is 2π.",
          "Paste getMeasurement and updateVision together.",
        ],
        checkedBy:
          "Paste both methods. Vantage reads them as Java and looks for the heading sent to the Limelight, the MegaTag2 estimate, a check for zero tags, the measurement added to the drivetrain, and a check on how fast the robot is turning.",
        check: {
          kind: "paste",
          prompt: "getMeasurement() from LimelightSubsys and updateVision() from RobotContainer",
          must: [
            { pattern: String.raw`SetRobotOrientation\s*\(`, flags: "", missing: "the heading is not sent. Call LimelightHelpers.SetRobotOrientation(…) every loop." },
            { pattern: String.raw`getBotPoseEstimate_wpiBlue_MegaTag2\s*\(`, flags: "", missing: "no MegaTag2 estimate (getBotPoseEstimate_wpiBlue_MegaTag2)." },
            { pattern: String.raw`tagCount\s*(==|<=?)\s*[01]\b`, flags: "", missing: "nothing skips a frame with no tags. Return early when tagCount is 0." },
            { pattern: String.raw`addVisionMeasurement\s*\(`, flags: "", missing: "vision never reaches the drivetrain. Call drivetrain.addVisionMeasurement(…)." },
            {
              pattern: String.raw`omegaRadiansPerSecond|getAngularVelocityZ\w*\s*\(|getRate\s*\(\s*\)`,
              flags: "",
              missing: "nothing checks how fast the robot is turning. Skip vision when Math.abs(omegaRadiansPerSecond) is above 2π.",
            },
          ],
          verify: { reads: "java" },
        },
        links: [
          { label: "RobotContainer.java (2026)", href: repoFile("src/main/java/frc/robot/RobotContainer.java") },
          { label: "LimelightSubsys.java (2026)", href: repoFile("src/main/java/frc/robot/subsystems/LimelightSubsys.java") },
        ],
      },
      {
        id: "prog-8-pr",
        title: "Get the vision change reviewed",
        why: "Vision decides where the robot thinks it is in every auto. A second pair of eyes on it is cheap.",
        do: ["Drive past a tag with AdvantageScope open and check the estimated pose does not jump while you spin.", "Commit, push and open a pull request.", "Paste its link here."],
        checkedBy: "Paste the pull request's link. Vantage asks GitHub that it changes the vision code.",
        check: {
          kind: "github-pr",
          changes: { pattern: String.raw`(Limelight|Vision|RobotContainer)[^/]*\.java$`, label: "the vision code" },
        },
      },
    ],
  },

  // ── Week 9 ────────────────────────────────────────────────────────────
  {
    id: "prog-week-9",
    track: "programming",
    week: 9,
    title: "Logs and debugging",
    why: "At an event you get about ten minutes between matches. Knowing how to open the log and find the moment it broke is the difference between a fix and a guess.",
    doneWhen: "The robot records a WPILib log as well as Phoenix's, and you showed a lead the moment something went wrong in a real log.",
    minutes: 120,
    links: [
      { label: "AdvantageScope log files", href: "https://docs.advantagescope.org/overview/log-files", primary: true },
      {
        label: "Phoenix 6 signal logging",
        href: "https://v6.docs.ctr-electronics.com/en/stable/docs/api-reference/api-usage/signal-logging.html",
      },
      {
        label: "Driver Station Log Viewer",
        href: "https://docs.wpilib.org/en/stable/docs/software/driverstation/driver-station-log-viewer.html",
      },
    ],
    tasks: [
      {
        id: "prog-9-datalog",
        title: "Record the dashboard values too",
        why: "Phoenix's SignalLogger (started in Telemetry.java) records the CTRE devices into .hoot files, but values like “Shooter At Speed” and “Selected Auto” are in no log. WPILib's DataLogManager records NetworkTables and the Driver Station into a .wpilog.",
        do: [
          "Read WPILib's on-robot logging page.",
          "In Robot's constructor add DataLogManager.start(); and DriverStation.startDataLog(DataLogManager.getLog());",
          "Build, deploy, enable for a minute, and confirm a .wpilog file appears (on a USB stick if one is in the roboRIO).",
          "Paste the two lines, or a github.com link to Robot.java on your branch.",
        ],
        checkedBy: "Paste the lines or the file's link. Vantage reads it as Java and looks for DataLogManager started and the Driver Station logged into it.",
        check: {
          kind: "paste",
          prompt: "The DataLogManager lines in Robot.java, or a github.com link",
          must: [
            { pattern: String.raw`DataLogManager\.start\s*\(`, flags: "", missing: "no DataLogManager.start()." },
            {
              pattern: String.raw`DriverStation\.startDataLog\s*\(\s*DataLogManager\.getLog\s*\(\s*\)`,
              flags: "",
              missing: "the Driver Station is not logged. Add DriverStation.startDataLog(DataLogManager.getLog()).",
            },
          ],
          verify: { reads: "java", githubFile: true },
        },
        links: [
          { label: "WPILib on-robot logging", href: "https://docs.wpilib.org/en/stable/docs/software/telemetry/datalog.html" },
          { label: "Robot.java (2026)", href: repoFile("src/main/java/frc/robot/Robot.java") },
        ],
      },
      {
        id: "prog-9",
        title: "Find the moment it went wrong",
        why: "Reading a real log once, with someone who has done it, is what makes you fast at it between matches.",
        do: [
          "After a practice match, copy the newest .hoot and .wpilog files off the robot.",
          "Open them in AdvantageScope (it opens .hoot files after you accept CTRE's license prompt).",
          "Plot one shooter motor's velocity and current, and the battery voltage.",
          "Open the Driver Station Log Viewer for the same match and look for brownouts or lost communication.",
          "Show a lead the moment something went wrong, or show that nothing did.",
        ],
        ...leadSignoff("Walked through a real log and named the moment something went wrong, or showed that nothing did."),
      },
    ],
  },

  // ── Week 10 ───────────────────────────────────────────────────────────
  {
    id: "prog-week-10",
    track: "programming",
    week: 10,
    title: "Competition-ready code",
    why: "The worst bugs at events come from untested pit changes. A build that runs on every push, a tag on what is on the robot and a practised rollback mean you always know what is deployed and can undo it in minutes.",
    doneWhen: "Every pull request builds on GitHub, the event build is tagged, you rolled back to the tag and redeployed, and the pre-match checklist is printed in the pit.",
    minutes: 150,
    links: [
      {
        label: "Robot code CI with GitHub Actions",
        href: "https://docs.wpilib.org/en/stable/docs/software/advanced-gradlerio/robot-code-ci.html",
        primary: true,
      },
      { label: "Git tagging", href: "https://git-scm.com/book/en/v2/Git-Basics-Tagging" },
    ],
    tasks: [
      {
        id: "prog-10-ci",
        title: "Build every pull request automatically",
        why: "A GitHub Action that builds every push catches a broken build before anyone deploys it in the pits. WPILib's docs give the exact workflow file.",
        do: [
          "Read WPILib's page on robot code CI with GitHub Actions.",
          "On a branch, add the workflow file from that page under .github/workflows/.",
          "Open a pull request and wait for GitHub's green check.",
          "Paste the pull request's link here.",
        ],
        checkedBy: "Paste the pull request's link. Vantage asks GitHub that it adds or changes a workflow file in .github/workflows.",
        check: {
          kind: "github-pr",
          changes: { pattern: String.raw`^\.github/workflows/[^/]+\.ya?ml$`, label: "a GitHub Actions workflow file" },
        },
      },
      {
        id: "prog-10",
        title: "Tag what is on the robot",
        why: "A tag is a name for one exact commit. When the robot misbehaves on Saturday, the tag tells you precisely which code was on it on Friday.",
        do: [
          "Before the event, merge to the season branch, deploy, and check the robot drives.",
          "Tag that exact commit with the event's name, for example git tag -a 2026gacmp -m \"On the robot at the district championship\".",
          "git push origin --tags",
          "Paste the tag's link from GitHub (Tags, then the tag's name).",
        ],
        checkedBy: "Paste the link to your event tag or release. Vantage asks GitHub that the tag exists.",
        check: { kind: "github-tag" },
      },
      {
        id: "prog-10-rollback",
        title: "Practise a rollback",
        why: "If a pit change makes things worse, going back to the tag is the fastest fix. Doing it once calmly means you can do it in five minutes under pressure.",
        do: [
          "Run git switch --detach followed by your tag's name. Git prints “HEAD is now at …”.",
          "Deploy (WPILib: Deploy Robot Code) and time it from “go” to a green Robot Code light.",
          "Switch back with git switch and your branch's name.",
          "Paste the git output and the deploy output.",
        ],
        checkedBy: "Paste both outputs. Vantage looks for Git moving to the tag's commit and a deploy that reached the 6925 roboRIO with BUILD SUCCESSFUL.",
        check: {
          kind: "paste",
          prompt: "What git switch --detach printed, then the deploy output",
          must: [{ pattern: String.raw`HEAD is now at [0-9a-f]{7,}`, missing: "no “HEAD is now at …” line. Run git switch --detach <tag> and paste what it printed." }, ...DEPLOY_RULES],
          verify: { reads: "output", mustNot: [BUILD_FAILED] },
        },
      },
      {
        id: "prog-10-checklist",
        title: "Print the pre-match checklist",
        why: "A checklist catches the boring failures (flat battery, wrong auto, camera unplugged) that lose more matches than bugs do.",
        do: [
          "Write the checklist with the drive team: battery voltage, the right auto shown as “Selected Auto” on the dashboard, a live Limelight image, and no CAN devices missing in Tuner X.",
          "Agree the rule: nothing is deployed in the pits unless it was tested in simulation or on the practice field first.",
          "Print it and tape it in the pit.",
        ],
        ...leadSignoff("The pre-match checklist is printed in the pit and the drive team uses it."),
        links: [{ label: "Pit repair triage", href: "/pit-repair-triage" }],
      },
    ],
  },
];
