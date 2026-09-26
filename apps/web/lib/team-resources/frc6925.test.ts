import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePaste } from "../guided/checks-6925";
import { checkNumbers } from "../guided/checks";
import { LIVE_SITE_ORIGIN } from "../site";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  LAB_TRACKS,
  TEAM_6925_REPO,
  TEAM_6925_RESOURCES,
  TEAM_6925_SETUP_COMMAND,
  TEAM_6925_STACK,
  TEAM_6925_WEEKS,
  allTeam6925Links,
  repoFile,
  resourcesForTrack,
  taskCheckLabel,
  totalLabMinutes,
  trackMinutes,
  weeksForTrack,
} from "./frc6925";

const allTasks = TEAM_6925_WEEKS.flatMap((week) => week.tasks.map((task) => ({ week, task })));

describe("Team 6925 lab", () => {
  it("is a real lab, not a stub", () => {
    expect(TEAM_6925_RESOURCES.length).toBeGreaterThanOrEqual(8);
    expect(TEAM_6925_WEEKS.length).toBeGreaterThanOrEqual(18);
    expect(allTasks.length).toBeGreaterThanOrEqual(55);
    expect(totalLabMinutes()).toBeGreaterThan(2000);
  });

  it("has a full programming track and a full mechanical track, weeks numbered in order", () => {
    expect(LAB_TRACKS.map((track) => track.id)).toEqual(["programming", "mechanical"]);
    for (const { id } of LAB_TRACKS) {
      const weeks = weeksForTrack(id);
      expect(weeks.length, id).toBeGreaterThanOrEqual(9);
      expect(weeks.map((week) => week.week), id).toEqual(weeks.map((_, index) => index + 1));
      expect(resourcesForTrack(id).length, id).toBeGreaterThanOrEqual(4);
      expect(trackMinutes(id), id).toBeGreaterThan(900);
    }
    expect(trackMinutes("programming") + trackMinutes("mechanical")).toBe(totalLabMinutes());
    // The CopyCommand block renders under this group.
    expect(TEAM_6925_RESOURCES.find((group) => group.id === "laptop-setup")?.track).toBe("programming");
    // Onboarding links land on the tracks, and week one is still laptop-and-deploy and shop safety.
    expect(weeksForTrack("programming")[0]!.title).toMatch(/laptop.*deploy/i);
    expect(weeksForTrack("mechanical")[0]!.title).toMatch(/safety/i);
  });

  it("uses unique ids so the jump links land and progress rows never collide", () => {
    const ids = [
      ...LAB_TRACKS.map((track) => track.id),
      ...TEAM_6925_RESOURCES.map((group) => group.id),
      ...TEAM_6925_WEEKS.map((week) => week.id),
      ...allTasks.map(({ task }) => task.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the old week ids as the step whose check matches, so earned progress still shows", () => {
    const byId = new Map(allTasks.map(({ task }) => [task.id, task]));
    const kinds: Record<string, string> = {
      "prog-1": "paste",
      "prog-2": "github-pr",
      "prog-3": "github-pr",
      "prog-4": "paste",
      "prog-5": "paste",
      "prog-6": "numbers",
      "prog-7": "paste",
      "prog-8": "paste",
      "prog-9": "lead-signoff",
      "prog-10": "github-tag",
      "mech-2": "onshape-material",
    };
    for (const [id, kind] of Object.entries(kinds)) expect(byId.get(id)?.check.kind, id).toBe(kind);
    for (let n = 1; n <= 9; n += 1) expect(byId.has(`mech-${n}`), `mech-${n}`).toBe(true);
  });

  it("uses https official docs and never the dead CAD Video Tutor host", () => {
    for (const link of allTeam6925Links()) {
      expect(link.href.startsWith("https://") || link.href.startsWith("/"), link.href).toBe(true);
      expect(link.href.toLowerCase().includes("thecadvideotutor")).toBe(false);
    }
    const hrefs = allTeam6925Links().map((link) => link.href);
    for (const host of ["docs.wpilib.org", "v6.docs.ctr-electronics.com", "pathplanner.dev", "docs.limelightvision.io", "docs.advantagescope.org", "cad.onshape.com"]) {
      expect(hrefs.some((href) => href.includes(host)), host).toBe(true);
    }
  });

  it("links the team's real 2026 code, and only files that exist there", () => {
    expect(TEAM_6925_REPO).toBe("https://github.com/JonathanV0/6925-Rebuilt");
    // Read from the repository on 2026-09-26 (see the notes at the top of frc6925.ts).
    const verified = new Set([
      "src/main/java/frc/robot/RobotContainer.java",
      "src/main/java/frc/robot/Robot.java",
      "src/main/java/frc/robot/CTREConfigs.java",
      "src/main/java/frc/robot/Telemetry.java",
      "src/main/java/frc/robot/generated/TunerConstants.java",
      "src/main/java/frc/robot/subsystems/ShooterSubsys.java",
      "src/main/java/frc/robot/subsystems/LimelightSubsys.java",
      "src/main/java/frc/robot/subsystems/CommandSwerveDrivetrain.java",
    ]);
    const repoLinks = allTeam6925Links().filter((link) => link.href.startsWith(`${TEAM_6925_REPO}/blob/`));
    expect(repoLinks.length).toBeGreaterThanOrEqual(8);
    for (const link of repoLinks) {
      const path = link.href.slice(repoFile("").length);
      expect(verified.has(path), path).toBe(true);
    }
    expect(TEAM_6925_STACK.map((row) => row.value).join(" ")).toMatch(/Phoenix 6.*CANivore/);
  });

  it("only links to in-app routes that exist", () => {
    const appDir = join(__dirname, "../../app");
    for (const link of allTeam6925Links()) {
      if (!link.href.startsWith("/")) continue;
      const route = link.href.split("#")[0]!.slice(1);
      const exists = existsSync(join(appDir, route, "page.tsx")) || route.startsWith("learn/guided/");
      expect(exists, link.href).toBe(true);
    }
  });

  it("passes orgId into withOrgHref so the lab typechecks", () => {
    const lab = readFileSync(join(__dirname, "../../app/learn/6925/team-6925-lab.tsx"), "utf8");
    expect(lab).not.toMatch(/withOrgHref\([^,)]+\)/);
    expect(lab).toMatch(/withOrgHref\("\/build", null\)/);
  });

  it("gives every group and week exactly one primary link", () => {
    for (const group of TEAM_6925_RESOURCES) {
      expect(group.links.filter((link) => link.primary), group.id).toHaveLength(1);
    }
    for (const week of TEAM_6925_WEEKS) {
      expect(week.links.filter((link) => link.primary), week.id).toHaveLength(1);
      expect(week.why.trim().length).toBeGreaterThan(40);
      expect(week.tasks.length, week.id).toBeGreaterThanOrEqual(2);
      expect(week.tasks.length, week.id).toBeLessThanOrEqual(5);
    }
  });

  it("breaks every week into small steps a student can act on, each saying how it is checked", () => {
    for (const week of TEAM_6925_WEEKS) {
      expect(week.minutes, week.id).toBeGreaterThanOrEqual(45);
      expect(week.minutes, week.id).toBeLessThanOrEqual(240);
      expect(week.doneWhen, week.id).not.toMatch(/\bunderstand/i);
      expectPlainCopy(week.why);
      expectPlainCopy(week.doneWhen);
      for (const task of week.tasks) {
        expect(task.do.length, task.id).toBeGreaterThanOrEqual(2);
        expect(task.do.length, task.id).toBeLessThanOrEqual(6);
        expectPlainCopy(task.why);
        expectPlainCopy(task.checkedBy);
        for (const line of task.do) expect(line.trim().length, `${task.id}: ${line}`).toBeGreaterThan(8);
        if (task.check.kind === "lead-signoff") {
          // A sign-off is labelled as one, never as a Vantage check.
          expect(task.checkedBy, task.id).toMatch(/lead/i);
          expect(taskCheckLabel(task)).toBe("A lead signs off");
        } else {
          expect(taskCheckLabel(task)).toBe("Vantage checks");
        }
      }
    }
    for (const group of TEAM_6925_RESOURCES) expectPlainCopy(group.blurb);
  });

  it("checks most steps with software, and uses a sign-off only where software cannot see", () => {
    const programming = allTasks.filter(({ week }) => week.track === "programming");
    const signoffs = programming.filter(({ task }) => task.check.kind === "lead-signoff");
    expect(signoffs.length / programming.length).toBeLessThan(0.2);
    const kinds = new Set(programming.map(({ task }) => task.check.kind));
    for (const kind of ["paste", "github-pr", "github-tag", "numbers"]) expect(kinds.has(kind), kind).toBe(true);
    const mechanical = allTasks.filter(({ week }) => week.track === "mechanical");
    expect(mechanical.filter(({ task }) => task.check.kind.startsWith("onshape")).length).toBeGreaterThanOrEqual(7);
    expect(mechanical.filter(({ task }) => task.check.kind === "numbers").length).toBeGreaterThanOrEqual(4);
  });

  it("gives every paste check a working rule set: a known-good sample for each passes", () => {
    const samples: Record<string, string> = {
      "prog-1-tools": "git version 2.47.1\ngh version 2.63.2\n✓ Logged in to github.com account a (keyring)",
      "prog-1-clone": "origin\thttps://github.com/JonathanV0/6925-Rebuilt.git (fetch)\nOn branch sotm-testing",
      "prog-1-vendordeps": JSON.stringify({ name: "CTRE-Phoenix (v6)", version: "26.1.1", frcYear: "2026" }),
      "prog-1-build": "BUILD SUCCESSFUL in 9s\n5 actionable tasks: 5 executed",
      "prog-1": "Using admin@10.69.25.2:22 for target roborio\nBUILD SUCCESSFUL in 20s\n***** Robot program startup complete *****",
      "prog-2-branch": "On branch alex/x",
      "prog-2-commit": " * [new branch]      alex/x -> alex/x\na1b2c3d Fix comment",
      "prog-3-read": 'new TalonFX(8, "CANivore"); new TalonFX(9, "CANivore"); new TalonFX(10, "CANivore");',
      "prog-3-bind": "operator.button(4).whileTrue(cmd);",
      "prog-3-sim": "HAL Extensions: Attempting to load: halsim_gui\nRobot program startup complete",
      "prog-4":
        "TalonFXConfiguration c; c.CurrentLimits.StatorCurrentLimitEnable = true; c.CurrentLimits.SupplyCurrentLimitEnable = true; NeutralModeValue.Brake; InvertedValue.Clockwise_Positive; m.getConfigurator().apply(c);",
      "prog-5": "driveGains = new Slot0Configs().withKP(0.1).withKS(0.2).withKV(0.12);",
      "prog-6-telemetry": "drivetrain.registerTelemetry(logger::telemeterize);",
      "prog-7": 'NamedCommands.registerCommand("a", c);\nAutoBuilder.buildAutoChooser("M-S");',
      "prog-8":
        "SetRobotOrientation(n, 0, 0, 0, 0, 0, 0); getBotPoseEstimate_wpiBlue_MegaTag2(n); if (e.tagCount == 0) return; if (s.omegaRadiansPerSecond > 6.3) return; d.addVisionMeasurement(p, t);",
      "prog-9-datalog": "DataLogManager.start(); DriverStation.startDataLog(DataLogManager.getLog());",
      "prog-10-rollback": "HEAD is now at abc1234 x\nUsing lvuser@roborio-6925-frc.local:22 for target roborio\nBUILD SUCCESSFUL in 20s",
    };
    const pasteTasks = allTasks.filter(({ task }) => task.check.kind === "paste");
    expect(pasteTasks.map(({ task }) => task.id).sort()).toEqual(Object.keys(samples).sort());
    for (const { task } of pasteTasks) {
      if (task.check.kind !== "paste") continue;
      const result = evaluatePaste(task.check, samples[task.id]!);
      expect(result.passed, `${task.id}: ${result.message}`).toBe(true);
      expect(evaluatePaste(task.check, "hello").passed, task.id).toBe(false);
    }
  });

  it("gives every numbers check two fields and a tolerance that measured values can meet", () => {
    for (const { task } of allTasks) {
      if (task.check.kind !== "numbers") continue;
      const [a, b] = task.check.fields;
      expect(task.check.fields).toHaveLength(2);
      expect(task.check.within.tolerance, task.id).toBeGreaterThan(0);
      const same = checkNumbers(task.check, { [a!.id]: 10, [b!.id]: 10 });
      expect(same.passed, task.id).toBe(true);
      const off = checkNumbers(task.check, { [a!.id]: 10, [b!.id]: 10 + task.check.within.tolerance * 2 });
      expect(off.passed, task.id).toBe(false);
    }
  });

  it("points the setup command at a live, public copy of the script", () => {
    expect(TEAM_6925_SETUP_COMMAND).toBe(`irm ${LIVE_SITE_ORIGIN}/team-setup.ps1 | iex`);
    const script = readFileSync(join(__dirname, "../../public/team-setup.ps1"), "utf8");
    expect(script).toContain(TEAM_6925_SETUP_COMMAND);
    // `irm | iex` cannot follow a sign-in redirect, so the proxy must let it through.
    const proxy = readFileSync(join(__dirname, "../../proxy.ts"), "utf8");
    expect(proxy).toMatch(/^\s*"\/team-setup\.ps1",$/m);
  });

  it("installs the whole programming toolchain, GitHub included", () => {
    const script = readFileSync(join(__dirname, "../../public/team-setup.ps1"), "utf8");
    for (const wingetId of [
      "Microsoft.VisualStudioCode",
      "Git.Git",
      "GitHub.cli",
      "GitHub.GitHubDesktop",
      "REVRobotics.REVHardwareClient2",
      "9NVV4PWDW27Z",
    ]) {
      expect(script).toContain(`-Id '${wingetId}'`);
    }
    for (const repo of ["wpilibsuite/allwpilib", "mjansen4857/pathplanner", "SleipnirGroup/Choreo"]) {
      expect(script).toContain(`'${repo}'`);
    }
    expect(script).toContain("gh auth login");
    // A year folder on disk is not "current": the script compares the installed
    // extension version and upgrades through the command-line installer.
    expect(script).toContain("wpilibsuite.vscode-wpilib-");
    expect(script).toContain("WPILibInstaller-CLI.exe");
    expect(script).toContain("--install-mode");
    expect(script).toContain("--force");
    expect(script).toContain("winget upgrade");
    expect(script).not.toContain("already installed at");
  });
});
