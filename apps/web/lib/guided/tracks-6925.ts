import { TEAM_6925_WEEKS } from "../team-resources/frc6925";
import type { GuidedStep, GuidedTrack, StepCheck } from "./types";

/* ----------------------------------------------------- Team 6925: programming */

const PROGRAMMING_CHECKS: Record<string, { checkedBy: string; check: StepCheck }> = {
  "prog-1": {
    checkedBy: "Paste the end of the deploy output and the Driver Station console. Vantage looks for a successful build and the robot program starting.",
    check: {
      kind: "paste",
      prompt: "Deploy output, then the Driver Station console",
      must: [
        { pattern: "BUILD SUCCESSFUL", missing: "the deploy output does not say BUILD SUCCESSFUL. Run “WPILib: Deploy Robot Code” again and paste its last lines." },
        { pattern: "Robot program starting|\\*\\*\\*\\*\\* Robot program startup complete", missing: "the console does not show “Robot program starting”. Enable in the Driver Station and paste the console lines." },
      ],
    },
  },
  "prog-2": {
    checkedBy: "Paste your pull request's link. Vantage asks GitHub that it exists and has at least one comment or review.",
    check: { kind: "github-pr", minComments: 1 },
  },
  "prog-3": {
    checkedBy: "Paste the pull request with your button-and-motor change. Vantage asks GitHub that it exists.",
    check: { kind: "github-pr" },
  },
  "prog-4": {
    checkedBy: "Paste your motor config block. Vantage looks for a current limit, an idle or neutral mode, and an inversion setting.",
    check: {
      kind: "paste",
      prompt: "Your motor configuration code",
      must: [
        { pattern: "CurrentLimit|currentLimit|CurrentLimits", missing: "no current limit. Set smartCurrentLimit (SPARK) or CurrentLimits (Talon FX)." },
        { pattern: "IdleMode|idleMode|NeutralMode", missing: "no idle mode. Set brake or coast (IdleMode / NeutralModeValue)." },
        { pattern: "nvert", missing: "no inversion setting. Set inverted(...) or InvertedValue even when it is false, so it is a decision." },
      ],
    },
  },
  "prog-5": {
    checkedBy: "Paste the gains from your code. Vantage looks for a P gain and feedforward (kS / kV) values.",
    check: {
      kind: "paste",
      prompt: "The PID and feedforward gains in your code",
      must: [
        { pattern: "kP|\\bp\\s*\\(|setP\\s*\\(|withKP", missing: "no P gain. Put the SysId-derived kP in the code." },
        { pattern: "kS|kV|SimpleMotorFeedforward|ArmFeedforward|ElevatorFeedforward|withKS|withKV", missing: "no feedforward. Add kS and kV from your SysId run." },
      ],
    },
  },
  "prog-6": {
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
  "prog-7": {
    checkedBy: "Paste your AutoBuilder setup. Vantage looks for AutoBuilder being configured and an auto chooser.",
    check: {
      kind: "paste",
      prompt: "Your AutoBuilder configuration and chooser",
      must: [
        { pattern: "AutoBuilder\\.configure", missing: "AutoBuilder is not configured. Call AutoBuilder.configure(...) in the drive subsystem." },
        { pattern: "buildAutoChooser|SendableChooser", missing: "no auto chooser. Use AutoBuilder.buildAutoChooser() and put it on the dashboard." },
      ],
    },
  },
  "prog-8": {
    checkedBy: "Paste your vision code. Vantage looks for a pose estimator feeding addVisionMeasurement.",
    check: {
      kind: "paste",
      prompt: "The code that adds vision to your pose estimate",
      must: [
        { pattern: "PhotonPoseEstimator|LimelightHelpers|getBotPose", missing: "no vision pose source (PhotonPoseEstimator or LimelightHelpers)." },
        { pattern: "addVisionMeasurement", missing: "vision is not fed to the estimator. Call addVisionMeasurement(pose, timestamp)." },
      ],
    },
  },
  "prog-9": {
    checkedBy: "A programming lead watches you walk through one real log and signs the step off.",
    check: { kind: "lead-signoff", what: "Walked through a real log and named the moment something went wrong" },
  },
  "prog-10": {
    checkedBy: "Paste the link to your event tag or release. Vantage asks GitHub that the tag exists.",
    check: { kind: "github-tag" },
  },
};

const MECHANICAL_CHECKS: Record<string, { checkedBy: string; check: StepCheck }> = {
  "mech-2": {
    checkedBy: "Vantage reads your part's mass from Onshape. It passes when Onshape reports a mass for the Part Studio you paste.",
    check: { kind: "onshape-mass" },
  },
};

function weeksAsSteps(track: "programming" | "mechanical", checks: Record<string, { checkedBy: string; check: StepCheck }>): GuidedStep[] {
  return TEAM_6925_WEEKS.filter((week) => week.track === track).map((week) => {
    const checked = checks[week.id] ?? {
      checkedBy: `A lead checks it with you: ${week.verify}`,
      check: { kind: "lead-signoff", what: week.verify } as StepCheck,
    };
    return {
      id: week.id,
      title: `Week ${week.week}: ${week.title}`,
      why: week.why,
      do: week.steps,
      checkedBy: checked.checkedBy,
      check: checked.check,
      links: week.links.slice(0, 4).map((link) => ({ label: link.label, href: link.href })),
    };
  });
}

const FRC6925_PROGRAMMING: GuidedTrack = {
  id: "frc6925-programming",
  title: "Team 6925 programming, week by week",
  summary:
    "The team's programming path from a new laptop to competition-ready code: WPILib, Git, command-based Java, motors, closed loop, swerve, autos, vision and logs. Each week ends with a check Vantage runs or a lead signs off.",
  time: "Ten weeks, about 3 hours each",
  audience: "Team 6925 programmers, first year and up.",
  steps: weeksAsSteps("programming", PROGRAMMING_CHECKS),
};

const FRC6925_MECHANICAL: GuidedTrack = {
  id: "frc6925-mechanical",
  title: "Team 6925 mechanical and CAD, week by week",
  summary:
    "Shop safety to pit repair: tools, Onshape, stock and fasteners, power transmission, drawings, mechanisms, prototyping, weight and wiring. Onshape weeks are checked in Onshape; shop weeks are signed off by a lead.",
  time: "Nine weeks, about 3 hours each",
  audience: "Team 6925 build and CAD students.",
  steps: weeksAsSteps("mechanical", MECHANICAL_CHECKS),
};

/** Team 6925's own weeks: programming and mechanical/CAD. */
export const FRC6925_TRACKS: GuidedTrack[] = [FRC6925_PROGRAMMING, FRC6925_MECHANICAL];
