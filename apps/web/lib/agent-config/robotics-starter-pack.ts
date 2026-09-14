/**
 * Starter Cursor rules and skills for an FRC robot-code repo.
 *
 * Specs are blanks on purpose. A lead fills them from CAD or the cart.
 * Do not invent wheel size, FOV, latency, or a second Limelight.
 */

export type StarterPackItem = {
  kind: "rules" | "skill";
  name: string;
  description: string;
  markdown: string;
};

export const ROBOTICS_STARTER_PACK: StarterPackItem[] = [
  {
    kind: "rules",
    name: "one-limelight",
    description: "This team has one Limelight. Never invent a second camera or a detection %.",
    markdown: `---
description: "This team has one Limelight. Never invent a second camera or a detection %."
alwaysApply: true
---

# One Limelight

- This robot has **one** Limelight. Do not add a second camera name, pipeline farm, or stereo setup unless a lead has written that a second camera exists.
- Camera hostname / NetworkTables name: _(fill in from the Limelight page — leave blank until then)_
- Pipeline you are allowed to edit: _(fill in the name the page shows)_
- Leave FOV, latency, and detection % blank unless the Limelight page shows that number right now.
- Official docs: https://docs.limelightvision.io/
`,
  },
  {
    kind: "rules",
    name: "no-invented-numbers",
    description: "Do not invent mass, ratings, win odds, or camera metrics.",
    markdown: `---
description: "Do not invent mass, ratings, win odds, or camera metrics."
alwaysApply: true
---

# No invented numbers

- Do not type mass, moment of inertia, or density. Learn CAD reads those from Onshape or says it graded nothing.
- Do not invent match scores, ratings, or win odds. Blank is honest.
- Do not invent wheel diameter, gear ratio, or bumper size. Fill the blanks below from CAD or the cart, or leave them empty.

## Robot spec blanks (fill from CAD / the cart)

- Wheel diameter:
- Drive gear ratio:
- Bumper width:
- Limelight mount part name in CAD:
`,
  },
  {
    kind: "rules",
    name: "github-collab",
    description: "One team repo. Pull, branch, push, one PR. Never push to main.",
    markdown: `---
description: "One team repo. Pull, branch, push, one PR. Never push to main."
globs: "**/*"
alwaysApply: false
---

# GitHub with this team

- Clone and push only the repository the lead named. Do not start a second remote.
- Pull the default branch before you edit.
- One short branch per job. Push that branch. Open one pull request.
- Never push to main. Never force-push unless the lead is standing next to you and asked.
- Official Git basics: https://docs.github.com/en/get-started/using-git
`,
  },
  {
    kind: "rules",
    name: "one-job-prompts",
    description: "Do the named job, then self-review. Extra features are out of scope.",
    markdown: `---
description: "Do the named job, then self-review. Extra features are out of scope."
alwaysApply: true
---

# One job, then self-review

- Do only what the prompt named. If a second feature would be nice, write it down and stop.
- Do not deploy to Vercel.
- End every task with a self-review: files changed, what you verified, what stayed blank.
- If a scoring rule or camera number is not published or not on the Limelight page, say so.
`,
  },
  {
    kind: "skill",
    name: "limelight-one-camera",
    description: "Bench-check and code against the single Limelight on this robot.",
    markdown: `---
name: limelight-one-camera
description: Bench-check and code against the single Limelight on this robot.
---

# Skill: one Limelight

1. Open https://docs.limelightvision.io/ and the camera's own web page.
2. Confirm a live image. If there is no live image, stop — do not invent a stream.
3. Use the one camera name the lead wrote down. Refuse a second Limelight unless hardware exists.
4. Do not fill detection %, FOV, or latency from memory.
5. Self-review: camera name used, pipeline name, numbers left blank.
`,
  },
  {
    kind: "skill",
    name: "github-team-pr",
    description: "Pull, branch, commit, push, and open one pull request on the team repo.",
    markdown: `---
name: github-team-pr
description: Pull, branch, commit, push, and open one pull request on the team repo.
---

# Skill: one team pull request

1. Pull the default branch.
2. Create one short branch named for the job.
3. Change only the files the prompt listed.
4. Commit with a why sentence. Push that branch. Open one PR.
5. Self-review: PR URL and the file list. Stop.
`,
  },
  {
    kind: "skill",
    name: "agent-self-review",
    description: "Close a task only after a self-review of the diff and blanks.",
    markdown: `---
name: agent-self-review
description: Close a task only after a self-review of the diff and blanks.
---

# Skill: self-review before you stop

Write four lines, then stop:

1. Goal you completed (one sentence).
2. Files you changed.
3. Checks you ran (or could not run, and why).
4. Numbers and cameras you left blank on purpose.
`,
  },
];

export function starterPackRules(): StarterPackItem[] {
  return ROBOTICS_STARTER_PACK.filter((item) => item.kind === "rules");
}

export function starterPackSkills(): StarterPackItem[] {
  return ROBOTICS_STARTER_PACK.filter((item) => item.kind === "skill");
}

export function starterPackCursorAsk(): string {
  return [
    "Add these Vantage robotics rules as .cursor/rules/vantage/*.mdc and these skills as .cursor/skills/vantage/<name>/SKILL.md.",
    "Do not fill robot spec blanks. This team has one Limelight.",
    "Self-review: list each file you wrote, then stop.",
  ].join(" ");
}
