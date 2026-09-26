/**
 * Small building blocks the Team 6925 weeks share: the 2026 repository, and the ways a step is
 * checked. Kept apart from frc6925.ts so the week files can use them without a circular import.
 */

import { DEPLOY_TO_6925, ROBOT_PROGRAM_STARTED } from "../guided/checks-6925";
import type { StepCheck } from "../guided/types";
import { LIVE_SITE_ORIGIN } from "../site";

/** The 2026 robot code, as linked from the team's 2026 Open Alliance build thread. */
export const TEAM_6925_REPO = "https://github.com/JonathanV0/6925-Rebuilt";
/** The branch the 2026 code was developed on (the repository's default branch). */
export const TEAM_6925_BRANCH = "sotm-testing";

/** A file in the 2026 robot code, on the branch the team worked on. */
export function repoFile(path: string): string {
  return `${TEAM_6925_REPO}/blob/${TEAM_6925_BRANCH}/${path}`;
}

/**
 * One command that sets a Windows laptop up for robot code, or brings an old
 * one current. Paste it into PowerShell.
 *
 * It resolves WPILib, PathPlanner and Choreo from their official release feeds at run
 * time rather than pinning a version here, so it does not go stale mid-season.
 * The script is `apps/web/public/team-setup.ps1`.
 */
export const TEAM_6925_SETUP_COMMAND = `irm ${LIVE_SITE_ORIGIN}/team-setup.ps1 | iex`;

export type Checked = { checkedBy: string; check: StepCheck };

/**
 * Software cannot see this (a band saw, a printed checklist, a robot moving the right way). A
 * lead checks it with the student, who then marks it done; the page labels it that way.
 */
export function leadSignoff(what: string): Checked {
  return {
    checkedBy: `No software can see this, so a lead checks it with you and then you mark it done. The lead is looking for: ${what.charAt(0).toLowerCase()}${what.slice(1)}`,
    check: { kind: "lead-signoff", what },
  };
}

/** Rules every deploy check shares: it reached a 6925 roboRIO and finished. */
export const DEPLOY_RULES = [
  {
    pattern: DEPLOY_TO_6925,
    missing:
      "the output has no “Using … for target roborio” line for a 6925 roboRIO. Check the Driver Station says 6925 and shows Communications, then deploy again and copy from “Discovering Target roborio”.",
  },
  { pattern: "BUILD SUCCESSFUL", flags: "", missing: "the deploy output does not end with BUILD SUCCESSFUL. Deploy again and copy the last lines." },
];

export const BUILD_FAILED = {
  pattern: "BUILD FAILED",
  flags: "",
  found: "the output says BUILD FAILED. Read the first error above it, fix it (or ask a lead), and try again.",
};

export const PROGRAM_STARTED_RULE = {
  pattern: ROBOT_PROGRAM_STARTED,
  missing: "there is no line saying the robot program started. Enable the robot and copy the console line “Robot program startup complete”.",
};
