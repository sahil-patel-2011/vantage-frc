import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { githubConnectionHref } from "../github/github-related";

/** Known teaching sample — proposals may use the grounded sample diff only for this content. */
export const CODE_COACH_SAMPLE = `public void periodic() {
  Timer.delay(0.02);
  driveMotor.set(3);
}`;

/** Grounded unified diff for CODE_COACH_SAMPLE only — never invent diffs for other source. */
export const CODE_COACH_SAMPLE_DIFF = [
  `--- a/src/main/java/frc/robot/subsystems/DriveSubsystem.java`,
  `+++ b/src/main/java/frc/robot/subsystems/DriveSubsystem.java`,
  "@@ -1,4 +1,4 @@",
  " public void periodic() {",
  "- Timer.delay(0.02);",
  "- driveMotor.set(3);",
  "+ driveMotor.set(MathUtil.clamp(demand, -1.0, 1.0));",
  " }",
].join("\n");

export type CodeCoachRelatedId = "cad" | "github" | "chat" | "pair" | "usage" | "budgets";

export type CodeCoachRelatedLink = {
  id: CodeCoachRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from Code Coach → CAD, GitHub context, and AI chat.
 * Never DEMO code samples or invented review findings.
 */
export function codeCoachRelatedLinks(
  orgId?: string | null,
  options?: { include?: CodeCoachRelatedId[] },
): CodeCoachRelatedLink[] {
  if (!orgId) return [];
  const include = options?.include ? new Set(options.include) : null;
  const all: CodeCoachRelatedLink[] = [
    { id: "cad", label: "CAD", href: hubHref("/build", "cad", orgId) },
    { id: "github", label: "GitHub context", href: githubConnectionHref(orgId) },
    { id: "chat", label: "AI chat", href: hubHref("/ai", "chat", orgId) },
    { id: "pair", label: "Pair VS Code", href: withOrgHref("/editor/pair", orgId) },
    { id: "usage", label: "AI usage", href: withOrgHref("/team/usage", orgId) },
    { id: "budgets", label: "Budgets", href: hubHref("/ai", "budgets", orgId) },
  ];
  return all.filter((link) => !include || include.has(link.id));
}

/** Primary Soft-UI strip: CAD · GitHub · AI chat. */
export const CODE_COACH_RELATED_INCLUDE: CodeCoachRelatedId[] = ["cad", "github", "chat", "pair"];

export type CodeCoachNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for empty / setup Code Coach.
 * Points at workspace, GitHub, CAD, and AI chat — never invented findings.
 */
export function codeCoachNextActions(input: {
  orgId?: string | null;
  hasSource?: boolean;
  hasReview?: boolean;
}): CodeCoachNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Local pattern review works without a model key. Pairing VS Code and GitHub need a team workspace.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: CodeCoachNextAction[] = [];

  if (!input.hasSource) {
    actions.push({
      id: "paste",
      label: "Paste robot source",
      detail: "Drop subsystem code into the editor, or load the teaching sample — findings only appear after you run a review.",
      href: "#cdc-source",
      primary: true,
    });
  } else if (!input.hasReview) {
    actions.push({
      id: "review",
      label: "Run a local risk review",
      detail: "Pattern matching runs in your browser.",
      href: "#cdc-source",
      primary: true,
    });
  }

  actions.push(
    {
      id: "cad",
      label: "Open CAD",
      detail: "Engineering briefs and human-approved geometry live on Build · CAD (metered when AI plans).",
      href: hubHref("/build", "cad", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "github",
      label: "Connect GitHub",
      detail: "Link a robot-code repo so Bugbot can scan it. PAT or OAuth — read-only, never a push.",
      href: githubConnectionHref(orgId),
    },
    {
      id: "chat",
      label: "Open AI chat",
      detail: "Team-aware assistant uses plan credits. Distinct from Code Coach’s free local pattern pass.",
      href: hubHref("/ai", "chat", orgId),
    },
    {
      id: "bugbot",
      label: "Run AI Bugbot",
      detail: "Subscription uses your plan/BYO key. Bugbot Ultra is $1 scan, $2 fix, $1 recheck.",
      href: withOrgHref("/bugbot", orgId),
    },
  );

  return actions;
}

/**
 * True when source still matches the teaching sample (normalize newlines).
 * Sample proposals are only allowed for this content — never invent diffs elsewhere.
 */
export function isCodeCoachSampleContent(content: string): boolean {
  return content.replace(/\r\n/g, "\n").trim() === CODE_COACH_SAMPLE.trim();
}

/**
 * Build a proposal payload only when grounded — sample teaching diff or caller-supplied unifiedDiff.
 * Returns null when inventing a fix would be required.
 */
export function groundedCodeCoachProposal(input: {
  path: string;
  content: string;
  unifiedDiff?: string;
}): { summary: string; unifiedDiff: string } | null {
  const supplied = input.unifiedDiff?.trim() ?? "";
  if (supplied.startsWith("--- ") && supplied.includes("\n+++ ")) {
    return { summary: "Proposed safe change", unifiedDiff: supplied };
  }
  if (isCodeCoachSampleContent(input.content)) {
    return {
      summary: "Clamp motor output and remove blocking sleep",
      unifiedDiff: CODE_COACH_SAMPLE_DIFF.replaceAll(
        "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
        input.path || "src/main/java/frc/robot/subsystems/DriveSubsystem.java",
      ),
    };
  }
  return null;
}
