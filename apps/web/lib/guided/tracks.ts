import { TEAM_6925_WEEKS } from "../team-resources/frc6925";
import type { GuidedStep, GuidedTrack, StepCheck } from "./types";

/* ------------------------------------------------------------ Onshape: first part */

const ONSHAPE_FIRST_PART: GuidedTrack = {
  id: "onshape-first-part",
  title: "Your first Onshape part, checked step by step",
  summary:
    "A mounting plate from a blank Part Studio: sketch, extrude, holes, fillets, a thickness variable and a material. After each step Vantage reads your Part Studio in Onshape and tells you whether it is there.",
  time: "About 90 minutes",
  audience: "New CAD students. No CAD experience needed.",
  steps: [
    {
      id: "connect",
      title: "Connect your Onshape account",
      why: "Vantage checks your work by reading your own Part Studio, so it needs your permission to read it. It only reads.",
      do: [
        "Make a free Onshape Education account at onshape.com if you do not have one (use your school email).",
        "In Vantage open CAD → Connections and press Connect Onshape, then approve the read access Onshape asks for.",
        "Come back to this page and press Check.",
      ],
      checkedBy: "Vantage asks Onshape whether your account is connected.",
      check: { kind: "onshape-connected" },
      links: [{ label: "CAD connections", href: "/cad/connections" }],
    },
    {
      id: "part-studio",
      title: "Make a document and name the Part Studio",
      why: "One document per mechanism keeps a robot's CAD findable. The Part Studio is where parts are drawn.",
      do: [
        "In Onshape press Create → Document and name it “Mounting plate – your name”.",
        "Right-click the Part Studio 1 tab at the bottom, choose Rename and call it “Plate”.",
        "Copy the address from the browser's address bar while the Plate tab is open and paste it below.",
      ],
      checkedBy: "Vantage opens the Part Studio at that address. Any Part Studio you can open passes; it may be empty.",
      check: { kind: "onshape-features", expect: [], anyOf: false },
    },
    {
      id: "sketch",
      title: "Sketch a 6 × 4 inch rectangle on the Top plane",
      why: "Every part starts as a 2D sketch. Dimensions make it exact instead of “about right”.",
      do: [
        "Press Sketch, then click the Top plane.",
        "Pick the Center-point rectangle, click the origin, and drag out a rectangle.",
        "Press D (Dimension) and set the width to 6 in and the height to 4 in. The lines turn black when fully defined.",
        "Press the green check to finish the sketch.",
      ],
      checkedBy: "Vantage looks for a sketch in the Part Studio.",
      check: { kind: "onshape-features", expect: [{ featureType: "newSketch", label: "a sketch" }] },
    },
    {
      id: "extrude",
      title: "Extrude it into a 0.25 inch plate",
      do: [
        "Press Extrude and select the rectangle's face.",
        "Set the depth to 0.25 in and press the green check. You now have a solid part.",
      ],
      checkedBy: "Vantage looks for an extrude.",
      check: { kind: "onshape-features", expect: [{ featureType: "extrude", label: "an extrude" }] },
    },
    {
      id: "holes",
      title: "Add four #10 clearance holes",
      why: "Holes placed from dimensions line up with the real frame; holes placed by eye do not.",
      do: [
        "Sketch on the top face of the plate and draw one point 0.5 in in from two edges.",
        "Use the Hole tool on that point: Simple, #10 clearance (0.201 in), Through all.",
        "Pattern it to the other three corners with Linear pattern, or place four points and one Hole.",
      ],
      checkedBy: "Vantage looks for a Hole feature, or a second extrude that cuts material away.",
      check: {
        kind: "onshape-features",
        anyOf: true,
        expect: [
          { featureType: "hole", label: "a Hole" },
          { featureType: "extrude", min: 2, label: "a second extrude (a cut)" },
        ],
      },
    },
    {
      id: "fillet",
      title: "Round the four corners",
      do: ["Press Fillet, click the four vertical corner edges, set 0.25 in and press the green check."],
      checkedBy: "Vantage looks for a fillet.",
      check: { kind: "onshape-features", expect: [{ featureType: "fillet", label: "a fillet" }] },
    },
    {
      id: "variable",
      title: "Make the thickness a variable",
      why: "When the plate goes from 0.25 in to 0.125 in, one number changes instead of hunting through features.",
      do: [
        "Press Variable (the # icon), name it thickness and set it to 0.25 in. Drag it to the top of the feature list.",
        "Edit the extrude and type #thickness as the depth.",
      ],
      checkedBy: "Vantage looks for a Variable feature.",
      check: { kind: "onshape-features", expect: [{ featureType: "assignVariable", label: "a Variable" }] },
    },
    {
      id: "material",
      title: "Give the part a material",
      why: "Weight budgets and center-of-mass checks come from the material. A part with no material weighs nothing.",
      do: [
        "Right-click the part in the Parts list, choose Assign material, and pick Aluminum 6061.",
        "Check the mass with the Mass properties tool (the scale icon): about 0.3 lb for this plate.",
      ],
      checkedBy: "Vantage reads the part's mass from Onshape. It passes when Onshape reports a mass.",
      check: { kind: "onshape-mass" },
    },
  ],
};

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

export const GUIDED_TRACKS: GuidedTrack[] = [ONSHAPE_FIRST_PART, FRC6925_PROGRAMMING, FRC6925_MECHANICAL];

export function guidedTrack(id: string): GuidedTrack | null {
  return GUIDED_TRACKS.find((track) => track.id === id) ?? null;
}

export function guidedStep(trackId: string, stepId: string): GuidedStep | null {
  return guidedTrack(trackId)?.steps.find((step) => step.id === stepId) ?? null;
}
