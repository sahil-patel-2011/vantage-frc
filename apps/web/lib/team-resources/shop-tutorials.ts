/**
 * Shop lab — student tutorials for the systems on one robot.
 *
 * Official vendor docs only. Do not invent camera FOV, latency, detection %,
 * or CAD mass. A team with one Limelight is treated as one camera.
 */

export type ShopTutorialLink = {
  label: string;
  href: string;
  primary?: boolean;
};

export type ShopTutorialId = "limelight" | "github" | "cursor-pack" | "agent-prompts" | "cad-systems";

export type ShopTutorial = {
  id: ShopTutorialId;
  title: string;
  blurb: string;
  steps: string[];
  verify: string;
  minutes: number;
  links: ShopTutorialLink[];
};

export const SHOP_TUTORIALS: ShopTutorial[] = [
  {
    id: "limelight",
    title: "One Limelight — what it actually does",
    blurb:
      "This shop has a single Limelight. That means one live view of the field, one pipeline at a time, and one camera name in robot code. Leave detection % blank unless the Limelight page shows one.",
    steps: [
      "Read Limelight's own getting-started page for the camera sitting on the bench — not a blog recap.",
      "Power the camera on the bench, not on the finished robot, and open its web page from a laptop on the same network.",
      "Write down the camera name you will use in code (often limelight). Do not invent a second camera.",
      "Aim at one real target. Save the pipeline name the page shows. If the page does not show a detection number, leave that cell blank.",
      "In WPILib, read only that one camera over NetworkTables. A second Limelight name in code is a bug until a second camera exists.",
    ],
    verify:
      "You can open the Limelight page and see a live image, and you can name the one camera in code. A screenshot without a live image is not done.",
    minutes: 80,
    links: [
      { label: "Limelight docs", href: "https://docs.limelightvision.io/", primary: true },
      {
        label: "WPILib AprilTag intro",
        href: "https://docs.wpilib.org/en/stable/docs/software/vision-processing/apriltag/apriltag-intro.html",
      },
    ],
  },
  {
    id: "github",
    title: "GitHub with the team — clone, pull, branch, push, PR",
    blurb:
      "Robot code lives in one team repo. Clone that repo, pull before you start, branch for your change, push that branch, then open a pull request. Do not start a second repo.",
    steps: [
      "Clone the repository the lead points you at. One clone on your laptop is enough.",
      "Before you edit, pull the default branch so you are not writing on last week's files.",
      "Make a short branch named for the job (vision-pipeline, not final-final).",
      "Change one thing. Commit with a sentence that says why. Push that branch — not main.",
      "Open a pull request. Ask one teammate to read the diff. Merge only after that review.",
    ],
    verify:
      "Your pull request is visible on GitHub, it is not pointed at a personal fork nobody can find, and someone on the team can open it.",
    minutes: 75,
    links: [
      {
        label: "GitHub Docs — Git basics",
        href: "https://docs.github.com/en/get-started/using-git",
        primary: true,
      },
      {
        label: "Push commits",
        href: "https://docs.github.com/en/get-started/using-git/pushing-commits-to-a-remote-repository",
      },
      {
        label: "Pull remote changes",
        href: "https://docs.github.com/en/get-started/using-git/getting-changes-from-a-remote-repository",
      },
      {
        label: "Open a pull request",
        href: "https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request",
      },
    ],
  },
  {
    id: "cursor-pack",
    title: "Cursor rules and skills for this robot",
    blurb:
      "The robotics pack is a folder of Cursor rules and skills with this team's blanks already named: one Limelight, GitHub habits, and no invented numbers. You ask Cursor to add that pack. It does not invent wheel size or camera FOV.",
    steps: [
      "Open Team agent config and copy the robotics starter pack, or run vantage-cad agent sync --agent cursor in the robot-code repo after a lead has saved the pack.",
      "In Cursor, paste: Add the Vantage robotics rules and skills from .cursor/rules/vantage and .cursor/skills/vantage. Keep robot spec blanks empty until CAD or the lead fills them.",
      "Fill only the blanks you can see on the real robot or in CAD: Limelight name, wheel diameter, bumper size. Leave every other number blank.",
      "Start a new Cursor chat and ask it to list the rules it loaded. If it cannot name the one-Limelight rule, the pack is not installed.",
    ],
    verify:
      "Cursor can name the one-Limelight rule and the no-invented-numbers rule. A chat that guesses a second camera or a typed mass has not loaded the pack.",
    minutes: 40,
    links: [
      { label: "Team agent config", href: "/team/agent-config", primary: true },
      { label: "Cursor rules", href: "https://cursor.com/docs/context/rules" },
      { label: "Cursor skills", href: "https://cursor.com/docs/skills" },
    ],
  },
  {
    id: "agent-prompts",
    title: "Prompts that do one job — then self-review",
    blurb:
      "A good agent prompt names the goal, the exact files, what not to touch, and how you will check. Ask it to self-review before it stops. Extra features and invented metrics are out of scope.",
    steps: [
      "Write the goal in one sentence. If you cannot, you are not ready to ask.",
      "List the files or page the agent may edit. Say do not deploy, do not invent numbers, do not open a second pull request.",
      "Add Done when: a check a person can see (live Limelight image, PR URL, test name).",
      "End with: Self-review the diff. List what you changed, what you verified, and what stayed blank.",
      "If the first answer drifts, paste the same prompt again. Do not add a second job to rescue it.",
    ],
    verify:
      "You have one saved prompt that names a single job and a self-review line. A prompt that says make everything better is not done.",
    minutes: 30,
    links: [
      { label: "Shop lab prompts", href: "/learn/shop#agent-prompts", primary: true },
      { label: "Team 6925 lab", href: "/learn/6925" },
    ],
  },
  {
    id: "cad-systems",
    title: "CAD names the parts code and vision have to find",
    blurb:
      "The Limelight mount, bumper, and wheel live in CAD first. Code and vision read those names. Learn CAD grades mass from Onshape — you never type it.",
    steps: [
      "Name the Limelight mount and the bumper in CAD the same words the programming lead will search for.",
      "Finish the CAD Video Tutor saddle on cast iron in Learn CAD before you ask an agent to resize a robot part.",
      "If a lead has bound a reference part, submit to the grader. If it graded nothing, that sentence is honest.",
      "Do not paste a mass into chat. The grader reads Onshape or it says it graded nothing.",
    ],
    verify:
      "The mount and bumper have searchable names in CAD, and Learn CAD is open to the next undone lesson. A typed mass is not a finish line.",
    minutes: 60,
    links: [
      { label: "Learn CAD", href: "/cad-learn", primary: true },
      {
        label: "CAD Video Tutor beginner set",
        href: "https://www.cadvideotutor.com/project-set/introduction-to-feature-based-modeling",
      },
    ],
  },
];

export function shopTutorialById(id: ShopTutorialId): ShopTutorial {
  const found = SHOP_TUTORIALS.find((tutorial) => tutorial.id === id);
  if (!found) {
    const exhaustive: never = id;
    return exhaustive;
  }
  return found;
}

export function allShopTutorialLinks(): ShopTutorialLink[] {
  return SHOP_TUTORIALS.flatMap((tutorial) => tutorial.links);
}

export function totalShopTutorialMinutes(): number {
  return SHOP_TUTORIALS.reduce((sum, tutorial) => sum + tutorial.minutes, 0);
}

/** Paste this into Cursor after the pack is on disk. */
export function cursorPackAskPrompt(): string {
  return [
    "Add the Vantage robotics rules and skills from .cursor/rules/vantage and .cursor/skills/vantage.",
    "Keep robot spec blanks empty until CAD or a lead fills them.",
    "This team has one Limelight. Do not invent a second camera, FOV, latency, or detection %.",
    "Do not invent mass, wheel size, or match scores.",
    "Self-review: list the rules and skills you loaded. Stop after that list.",
  ].join(" ");
}

export type AgentPromptTemplate = {
  id: string;
  title: string;
  body: string;
};

export const AGENT_PROMPT_TEMPLATES: AgentPromptTemplate[] = [
  {
    id: "limelight-code",
    title: "Read the one Limelight",
    body: `Goal: wire robot code to the single Limelight on this robot.
Do exactly: read that one camera over NetworkTables using the name the lead wrote down.
Do not: add a second camera, invent FOV or latency, invent a detection %, deploy, or push to main.
Done when: a deploy to a roboRIO we are allowed to use shows the Limelight page still has a live image, and code names only that camera.
Self-review: list files changed, the camera name you used, and every number you left blank.`,
  },
  {
    id: "github-pr",
    title: "One pull request",
    body: `Goal: get this change onto the team repo as one pull request.
Do exactly: pull the default branch, make one short branch, commit this job, push that branch, open one PR.
Do not: push to main, open a second repo, rewrite unrelated files, or force-push.
Done when: the PR URL opens and the diff is only this job.
Self-review: paste the PR URL and list files in the diff.`,
  },
  {
    id: "docs-only",
    title: "Docs and tutorials only",
    body: `Goal: improve the student tutorial for this page and nothing else.
Do exactly: edit the tutorial files named below so a new member can finish the verify line.
Do not: invent metrics, deploy to Vercel, or refactor unrelated boards.
Done when: the verify sentence is something a person can see, and tests for this tutorial pass.
Self-review: list files changed, tests you ran, and what stayed blank.`,
  },
];
