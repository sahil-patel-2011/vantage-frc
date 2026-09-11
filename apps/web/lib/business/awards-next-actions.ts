import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type AwardsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AwardsNextActionContext = {
  orgId?: string | null;
  submissionCount?: number;
  inProgressCount?: number;
  wonCount?: number;
  incompleteEssayCount?: number;
};

/**
 * Soft-UI next actions for the FIRST awards workbench.
 * Never invents DEMO win rates or award dollars — only org-local submission paths.
 */
export function awardsNextActions(ctx: AwardsNextActionContext): AwardsNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before starting FIRST award submissions.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const awardsHref = withOrgHref("/team/awards", orgId);
  const submissions = ctx.submissionCount ?? 0;

  if (submissions === 0) {
    return [
      {
        id: "start",
        label: "Start a catalog award submission",
        detail:
          "Pick Impact, Engineering Inspiration, or another FIRST award to seed essay prompts — empty is not a placeholder scoreboard.",
        href: awardsHref,
        primary: true,
      },
    ];
  }

  const actions: AwardsNextAction[] = [];
  const incomplete = ctx.incompleteEssayCount ?? 0;
  const inProgress = ctx.inProgressCount ?? 0;
  const won = ctx.wonCount ?? 0;

  if (incomplete > 0) {
    actions.push({
      id: "draft",
      label: `Finish ${incomplete} open essay item${incomplete === 1 ? "" : "s"}`,
      detail: "Draft responses save on blur. Mark items done as you finish.",
      href: awardsHref,
      primary: true,
    });
  } else if (inProgress > 0 && won === 0) {
    actions.push({
      id: "status",
      label: "Update submission status",
      detail:
        "Set Won only when the team actually receives the award — that feeds Business evidence, not invented wins.",
      href: awardsHref,
      primary: true,
    });
  }

  actions.push({
    id: "impact",
    label: "Log community impact evidence",
    detail: "Outreach hours and reach appear in narratives once someone records them.",
    href: withOrgHref("/impact", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "evidence",
    label: "Business · Awards & evidence",
    detail: "Record wins once for reuse in grant writing.",
    href: hubHref("/business", "evidence", orgId),
  });

  return actions.slice(0, 5);
}
