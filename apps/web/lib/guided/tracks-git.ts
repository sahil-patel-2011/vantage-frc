import type { GuidedTrack } from "./types";

/*
 * Git and GitHub for any team's programmers: the loop every robot-code change goes through
 * (branch → commit → push → pull request → review → merge). Each step is checked from what the
 * student's own terminal printed or by asking GitHub about their pull request, so a step only
 * counts when it really happened. Team 6925's own weeks cover the same ground in their repo.
 */

const GIT_HELP = (label: string, href: string) => ({ label, href });
const PRO_GIT = GIT_HELP("Pro Git book (free)", "https://git-scm.com/book/en/v2");
const GH_FLOW = GIT_HELP("GitHub flow", "https://docs.github.com/en/get-started/using-github/github-flow");

const FATAL = { pattern: String.raw`^fatal:`, flags: "m", found: "Git stopped with an error (fatal). Read the line after fatal:, fix it or ask a lead, and run it again." };
const NOT_FOUND = {
  pattern: String.raw`is not recognized as (the name of )?a cmdlet|command not found`,
  found: "Your terminal couldn't find that command. Close it, open a new one so it sees the new install, and run it again.",
};

const GIT_FIRST_PR: GuidedTrack = {
  id: "git-first-pr",
  title: "Git and GitHub: your first pull request",
  summary:
    "The loop every robot-code change goes through: get the code, make a branch, commit a small change, push it, open a pull request, answer a review, and keep your branch up to date. Vantage checks each step from what your terminal printed or by asking GitHub about your pull request.",
  time: "About 2 hours",
  audience: "New programmers on any team. Works on Windows, macOS and Linux.",
  steps: [
    {
      id: "install",
      title: "Install Git and the GitHub CLI, and sign in",
      why: "Git keeps every version of the code; GitHub is where the team shares it. The GitHub CLI (gh) opens pull requests from your terminal.",
      whenToUse: "Once per computer. Every laptop that changes robot code needs both, signed in to your own GitHub account, never a shared one.",
      example: "On Windows, the WPILib installer does not include Git: install Git from git-scm.com and the CLI from cli.github.com, then run gh auth login.",
      do: [
        "Install Git from git-scm.com and the GitHub CLI from cli.github.com (on a Mac with Homebrew: brew install git gh).",
        "Open a new terminal (PowerShell on Windows, Terminal on a Mac) and run gh auth login. Choose GitHub.com and sign in in the browser.",
        "Run git --version, then gh --version, then gh auth status, and paste what they printed below.",
      ],
      checkedBy: "Vantage looks for Git's version, the GitHub CLI's version and a signed-in GitHub account in what you pasted.",
      check: {
        kind: "paste",
        prompt: "What git --version, gh --version and gh auth status printed",
        must: [
          { pattern: String.raw`git version \d+\.\d+`, missing: "no “git version …” line. Run git --version in a new terminal." },
          { pattern: String.raw`gh version \d+\.\d+`, missing: "no “gh version …” line. Run gh --version in a new terminal." },
          { pattern: String.raw`Logged in to github\.com`, missing: "gh auth status doesn't say “Logged in to github.com”. Run gh auth login, then gh auth status again." },
        ],
        verify: { reads: "output", mustNot: [NOT_FOUND] },
      },
      links: [GIT_HELP("Install Git", "https://git-scm.com/downloads"), GIT_HELP("Install the GitHub CLI", "https://cli.github.com/")],
    },
    {
      id: "clone",
      title: "Get your team's robot code",
      why: "Cloning copies the whole project, with its history, to your laptop and remembers where it came from (origin).",
      whenToUse: "Once per project per laptop. After that you pull new changes instead of cloning again.",
      example: "gh repo clone your-team/robot-2026, then cd robot-2026. Ask a lead for the repository's name.",
      do: [
        "Run gh repo clone <team>/<repository> (or git clone with the repository's https address).",
        "Run cd into the new folder, then git remote -v.",
        "Paste what the clone and git remote -v printed.",
      ],
      checkedBy: "Vantage looks for the clone's “Cloning into” line and an origin on github.com.",
      check: {
        kind: "paste",
        prompt: "What the clone and git remote -v printed",
        must: [
          { pattern: String.raw`Cloning into '`, missing: "no “Cloning into …” line. Paste what the clone command printed." },
          {
            pattern: String.raw`^origin\s+(https://github\.com/|git@github\.com:)\S+\s+\(fetch\)`,
            flags: "m",
            missing: "no “origin … github.com … (fetch)” line. Run git remote -v inside the project folder.",
          },
        ],
        verify: { reads: "output", mustNot: [FATAL, NOT_FOUND] },
      },
      links: [PRO_GIT],
    },
    {
      id: "branch",
      title: "Make a branch for your change",
      why: "A branch keeps your work apart from main, the code that runs on the robot, until it has been reviewed.",
      whenToUse: "For every change, however small: one branch per fix or feature. Never commit straight to main.",
      example: "git switch -c fix-intake-speed for a change that only tunes the intake speed.",
      do: [
        "Run git switch -c <your-branch-name> (short, lowercase, words joined with dashes).",
        "Run git branch --show-current and paste both outputs.",
      ],
      checkedBy: "Vantage looks for “Switched to a new branch” and checks the current branch isn't main or master.",
      check: {
        kind: "paste",
        prompt: "What git switch -c and git branch --show-current printed",
        must: [{ pattern: String.raw`Switched to a new branch '[^']+'`, missing: "no “Switched to a new branch” line. Run git switch -c <name>." }],
        verify: {
          reads: "output",
          mustNot: [
            FATAL,
            { pattern: String.raw`^\s*(main|master)\s*$`, flags: "m", found: "you're still on main. Run git switch -c <name> to make your own branch first." },
          ],
        },
      },
    },
    {
      id: "commit",
      title: "Commit one small change",
      why: "A commit is a saved, labeled snapshot. Small commits with clear messages make a review easy and a bad change easy to undo.",
      whenToUse: "Each time one piece of the change works: a commit should do one thing you can describe in one line.",
      example: "Change a comment or a constant, then git add -A and git commit -m \"Lower intake speed to 0.6\".",
      do: [
        "Make a small change in VS Code and save it (a comment is fine).",
        "Run git add -A, then git commit -m \"<what you changed>\".",
        "Run git log --oneline -1 and paste both outputs.",
      ],
      checkedBy: "Vantage looks for the commit's “file changed” line and your commit in the log.",
      check: {
        kind: "paste",
        prompt: "What git commit and git log --oneline -1 printed",
        must: [
          { pattern: String.raw`\d+ files? changed`, missing: "no “1 file changed” line. Save your file, run git add -A, then git commit -m \"…\"." },
          { pattern: String.raw`^[0-9a-f]{7,40} \S`, flags: "m", missing: "no commit line. Run git log --oneline -1." },
        ],
        verify: {
          reads: "output",
          mustNot: [FATAL, { pattern: String.raw`nothing to commit`, found: "Git says there was nothing to commit. Save your change in VS Code first, then git add -A." }],
        },
      },
    },
    {
      id: "pull-request",
      title: "Push your branch and open a pull request",
      why: "Pushing puts your branch on GitHub; the pull request asks the team to review it and merge it into main.",
      whenToUse: "As soon as you have a first commit worth looking at. Mark it a draft if it isn't ready, so people can still comment.",
      example: "git push -u origin fix-intake-speed, then gh pr create --fill.",
      do: [
        "Run git push -u origin <your-branch-name>.",
        "Run gh pr create --fill (or open the link Git printed and press Create pull request).",
        "Paste the pull request's link below.",
      ],
      checkedBy: "Vantage asks GitHub that the pull request exists. The repository must be public.",
      check: { kind: "github-pr" },
      links: [GH_FLOW],
    },
    {
      id: "review",
      title: "Get a review and answer it",
      why: "A second pair of eyes catches what the author can't see. Answering every comment is how the code (and you) get better.",
      whenToUse: "On every pull request before it merges. Ask a specific person; fix on the same branch and push, and the pull request updates itself.",
      example: "A lead asks why the speed is 0.6; you reply with what you tested, or push a fix and reply “Done”.",
      do: [
        "Ask a programming lead or teammate to review your pull request.",
        "Answer each comment: push a fix to the same branch, or reply explaining why not.",
        "Paste the pull request's link again when it has at least one comment.",
      ],
      checkedBy: "Vantage asks GitHub that your pull request has at least one comment or review.",
      check: { kind: "github-pr", minComments: 1 },
    },
    {
      id: "update",
      title: "Bring your branch up to date with main",
      why: "Other people merge while you work. Pulling main into your branch shows conflicts on your laptop instead of on the robot.",
      whenToUse: "Before you push more work to an older branch, and whenever GitHub says your branch is out of date or has conflicts.",
      example: "git fetch origin, then git merge origin/main. If two people changed the same line, Git marks it; pick the right version, then commit.",
      do: [
        "On your branch, run git fetch origin, then git merge origin/main.",
        "If Git reports a conflict, open the file, keep the right lines, save, then git add -A and git commit.",
        "Paste what git merge origin/main printed.",
      ],
      checkedBy: "Vantage looks for Git saying the merge finished: already up to date, a fast-forward, or a merge made.",
      check: {
        kind: "paste",
        prompt: "What git merge origin/main printed",
        must: [
          {
            pattern: String.raw`Already up to date|Fast-forward|Merge made by`,
            missing:
              "no “Already up to date”, “Fast-forward” or “Merge made by” line. If Git stopped on a conflict, fix the marked lines, git add -A, git commit, and paste what git merge origin/main prints then.",
          },
        ],
        verify: {
          reads: "output",
          mustNot: [
            FATAL,
            { pattern: String.raw`Automatic merge failed`, found: "the merge stopped on a conflict. Fix the marked lines, git add -A, git commit, then paste the new output." },
          ],
        },
      },
    },
    {
      id: "practice-second-pr",
      practice: true,
      title: "Practice on your own: a real change, reviewed",
      why: "The same loop on a change the robot actually runs. No step-by-step this time.",
      do: [
        "On a new branch, change a Java file under src/main/java: a constant, a comment, or a small fix a lead suggests.",
        "Commit it with a clear message, push, and open a pull request.",
        "Get at least one review comment and answer it, then paste the pull request's link.",
      ],
      checkedBy: "Vantage asks GitHub that the pull request changes a Java file under src/main/java and has at least one comment or review.",
      check: { kind: "github-pr", minComments: 1, changes: { pattern: String.raw`^src/main/java/.+\.java$`, label: "a Java file under src/main/java" } },
    },
  ],
};

/** Git and GitHub for every team. */
export const GIT_TRACKS: GuidedTrack[] = [GIT_FIRST_PR];
