/**
 * Team 6925 lab — official coding, vision, and GitHub resources plus paced weeks.
 *
 * Every href was chosen because it is the vendor's own docs, not a mirror.
 * Do not add a link from memory.
 */

export type TeamResourceLink = {
  label: string;
  href: string;
  primary?: boolean;
};

export type TeamResourceGroup = {
  id: string;
  title: string;
  blurb: string;
  links: TeamResourceLink[];
};

export type PacedWeek = {
  id: string;
  week: number;
  title: string;
  why: string;
  steps: string[];
  verify: string;
  minutes: number;
  links: TeamResourceLink[];
};

export const TEAM_6925_RESOURCES: TeamResourceGroup[] = [
  {
    id: "vision",
    title: "Limelight and vision",
    blurb:
      "This shop has one Limelight. Start with Limelight's own docs — they match the camera on the cart. Do not invent a second camera or a detection %.",
    links: [
      { label: "Limelight docs", href: "https://docs.limelightvision.io/", primary: true },
      { label: "PhotonVision docs", href: "https://docs.photonvision.org/" },
    ],
  },
  {
    id: "code",
    title: "Robot code",
    blurb: "WPILib is the official FRC programming toolchain. PathPlanner is the path tool most 6925 autos start from.",
    links: [
      { label: "WPILib documentation", href: "https://docs.wpilib.org/en/stable/", primary: true },
      { label: "PathPlanner", href: "https://pathplanner.dev/home.html" },
      { label: "WPILib example projects", href: "https://docs.wpilib.org/en/stable/docs/software/examples-tutorials/wpilib-examples.html" },
    ],
  },
  {
    id: "github",
    title: "GitHub",
    blurb:
      "The Student Developer Pack is free software for students. Use it for private robot-code repos — not a second chat app. Pull, branch, push, then one pull request.",
    links: [
      { label: "GitHub Student Developer Pack", href: "https://education.github.com/pack", primary: true },
      { label: "GitHub Docs — Git basics", href: "https://docs.github.com/en/get-started/using-git" },
    ],
  },
  {
    id: "cursor",
    title: "Cursor robotics pack",
    blurb:
      "Ask Cursor to add the team's rules and skills. Robot spec blanks stay empty until CAD or a lead fills them. One Limelight — never a guessed second camera.",
    links: [
      { label: "Shop lab — Cursor pack", href: "/learn/shop#cursor-pack", primary: true },
      { label: "Team agent config", href: "/team/agent-config" },
      { label: "Cursor rules", href: "https://cursor.com/docs/context/rules" },
    ],
  },
  {
    id: "hardware",
    title: "Motors and controllers",
    blurb: "Vendor docs for the parts that actually show up on a 6925 bill of materials.",
    links: [
      { label: "REV Robotics docs", href: "https://docs.revrobotics.com/", primary: true },
      { label: "CTRE Phoenix 6 docs", href: "https://v6.docs.ctr-electronics.com/" },
    ],
  },
];

export const TEAM_6925_WEEKS: PacedWeek[] = [
  {
    id: "week-1",
    week: 1,
    title: "Laptop and first deploy",
    why: "Nothing else works until WPILib runs on your machine and you can push code to a roboRIO.",
    steps: [
      "Install WPILib from the official download page for your laptop.",
      "Open VS Code from the WPILib install, not a random copy.",
      "Create the getting-started example and deploy it to a roboRIO you are allowed to use.",
    ],
    verify: "The driver station shows the example running. A failed deploy is not a finished week.",
    minutes: 90,
    links: [{ label: "WPILib documentation", href: "https://docs.wpilib.org/en/stable/", primary: true }],
  },
  {
    id: "week-2",
    week: 2,
    title: "GitHub and the first commit",
    why: "A robot program that lives only on one laptop disappears the week that person is out sick.",
    steps: [
      "Create a GitHub account with an email you will still have next season.",
      "Apply for the Student Developer Pack with your school email.",
      "Clone the team repository the lead points you at — do not start a second one.",
      "Make one small comment change, commit it, and open a pull request.",
    ],
    verify: "Your pull request is visible on GitHub and someone on the team can open it.",
    minutes: 75,
    links: [
      { label: "GitHub Student Developer Pack", href: "https://education.github.com/pack", primary: true },
      { label: "GitHub Docs — Git basics", href: "https://docs.github.com/en/get-started/using-git" },
    ],
  },
  {
    id: "week-3",
    week: 3,
    title: "Limelight on the bench",
    why: "Vision week is wasted if the camera is still in the box. Read Limelight's own pages, then power it on the bench — not on the finished robot.",
    steps: [
      "Read the Limelight quick-start for your camera version.",
      "Connect the camera to a laptop on the bench and open its web page.",
      "Write down the pipeline you used and the target you aimed at. Leave detection % blank unless the camera page shows one.",
    ],
    verify: "You can open the Limelight page and see a live image. A screenshot without a live image is not done.",
    minutes: 80,
    links: [{ label: "Limelight docs", href: "https://docs.limelightvision.io/", primary: true }],
  },
  {
    id: "week-4",
    week: 4,
    title: "A PathPlanner auto that actually drives",
    why: "Autos fail in week one of competition when nobody practiced a path on the real field carpet.",
    steps: [
      "Open PathPlanner and load or draw one simple path the lead approves.",
      "Generate the path into the team project — do not start a second project.",
      "Run it on the practice field or a taped outline. Log whether it finished.",
    ],
    verify: "The robot follows the path you named. A path that only exists in simulation is not this week's finish line.",
    minutes: 90,
    links: [{ label: "PathPlanner", href: "https://pathplanner.dev/home.html", primary: true }],
  },
  {
    id: "week-5",
    week: 5,
    title: "CAD week — CAD Video Tutor then grade",
    why: "Programming and CAD share the same robot. A spacer that is the wrong mass shows up as a late night in the shop, not as a compile error.",
    steps: [
      "Open Learn CAD and finish the CAD Video Tutor Saddle Bracket on cast iron.",
      "Confirm the part appears under Explore Onshape with a last-edited time.",
      "Submit it to the grader only after a lead has bound the reference part.",
    ],
    verify:
      "The grader reports mass and spin against the reference, or it says it graded nothing. Either sentence is honest; a typed number is not.",
    minutes: 90,
    links: [
      { label: "Learn CAD", href: "/cad-learn", primary: true },
      {
        label: "CAD Video Tutor beginner set",
        href: "https://www.cadvideotutor.com/project-set/introduction-to-feature-based-modeling",
      },
    ],
  },
  {
    id: "week-6",
    week: 6,
    title: "GitHub collaboration — pull, branch, push, PR",
    why: "A commit that never leaves your laptop cannot be reviewed. Pull first, then one branch, one push, one pull request.",
    steps: [
      "Pull the default branch of the team repo before you type.",
      "Make a short branch named for the job. Edit one thing.",
      "Commit with a why sentence. Push that branch — not main.",
      "Open one pull request and ask a teammate to read the diff.",
    ],
    verify: "The pull request URL opens on GitHub and the diff is only that job.",
    minutes: 60,
    links: [
      {
        label: "Open a pull request",
        href: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request",
        primary: true,
      },
      { label: "Shop lab — GitHub", href: "/learn/shop#github" },
    ],
  },
  {
    id: "week-7",
    week: 7,
    title: "One Limelight in code",
    why: "Week 3 proved the camera is alive. This week the robot program names that one camera and nothing else.",
    steps: [
      "Open the Limelight page and confirm a live image still exists.",
      "Write the camera name the page uses into the team project — one name.",
      "Read that camera over NetworkTables. Do not add a second Limelight name.",
      "Leave detection % blank unless the camera page shows one right now.",
    ],
    verify:
      "Code names one camera, and the Limelight page still shows a live image. A typed detection % that the page does not show is not done.",
    minutes: 70,
    links: [
      { label: "Shop lab — one Limelight", href: "/learn/shop#limelight", primary: true },
      { label: "Limelight docs", href: "https://docs.limelightvision.io/" },
    ],
  },
  {
    id: "week-8",
    week: 8,
    title: "Cursor pack and one-job prompts",
    why: "An agent without the team's rules will invent a second camera or a mass. Load the pack, then use a prompt that names one job and a self-review.",
    steps: [
      "Open Shop lab and copy the robotics starter pack into Team agent config, or ask Cursor to add .cursor/rules/vantage and .cursor/skills/vantage.",
      "Fill only spec blanks you can see on the cart or in CAD.",
      "Paste one saved prompt from Shop lab. Do not add a second job.",
      "Read the agent's self-review. If it invented a number, the pack is not loaded.",
    ],
    verify:
      "Cursor can name the one-Limelight rule, and you have one pull request or local diff that matches the prompt you pasted.",
    minutes: 45,
    links: [
      { label: "Shop lab — Cursor pack", href: "/learn/shop#cursor-pack", primary: true },
      { label: "Team agent config", href: "/team/agent-config" },
    ],
  },
];

export function allTeam6925Links(): TeamResourceLink[] {
  return [
    ...TEAM_6925_RESOURCES.flatMap((group) => group.links),
    ...TEAM_6925_WEEKS.flatMap((week) => week.links),
  ];
}

export function totalLabMinutes(): number {
  return TEAM_6925_WEEKS.reduce((sum, week) => sum + week.minutes, 0);
}
