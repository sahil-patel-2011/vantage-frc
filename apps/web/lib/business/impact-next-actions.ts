import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type ImpactNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ImpactNextActionContext = {
  orgId?: string | null;
  activityCount?: number;
  totalHours?: number;
  readinessScore?: number;
  seasonYear?: number;
};

/**
 * Soft-UI next actions for Community Impact.
 * Never invents DEMO hours, people reached, or award readiness — only org-local paths.
 */
export function impactNextActions(ctx: ImpactNextActionContext): ImpactNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before logging community outreach.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const impactHref = withOrgHref("/impact", orgId);
  const season = ctx.seasonYear;
  const withSeason = (href: string) =>
    season && Number.isFinite(season) ? `${href}${href.includes("?") ? "&" : "?"}season=${season}` : href;

  const actions: ImpactNextAction[] = [];
  const activities = ctx.activityCount ?? 0;
  const hours = ctx.totalHours ?? 0;
  const score = ctx.readinessScore ?? 0;

  if (activities === 0) {
    actions.push({
      id: "first-activity",
      label: "Log your first outreach activity",
      detail: "STEM demos, mentoring, and community events create evidence — totals stay at zero until you record them.",
      href: withSeason(impactHref),
      primary: true,
    });
  } else if (hours <= 0) {
    actions.push({
      id: "hours",
      label: "Add duration on logged activities",
      detail: "Readiness uses recorded minutes only — never placeholder community hours.",
      href: withSeason(impactHref),
      primary: true,
    });
  } else if (score < 0.45) {
    actions.push({
      id: "broaden",
      label: "Broaden audiences and cadence",
      detail: "Add K-12 reach and activities across more months as you run events.",
      href: withSeason(impactHref),
      primary: true,
    });
  }

  actions.push({
    id: "awards",
    label: "Draft FIRST award essays",
    detail: "Pair logged impact evidence with catalog submissions on the awards workbench.",
    href: withOrgHref("/team/awards", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "evidence",
    label: "Record wins in Business · Awards",
    detail: "Awarded evidence for grants comes from submissions you mark won.",
    href: hubHref("/business", "evidence", orgId),
  });

  actions.push({
    id: "grants",
    label: "Open grant writing",
    detail: "Impact hours and activities flow into grant provenance only after you log them here.",
    href: withOrgHref("/team/grants", orgId),
  });

  actions.push({
    id: "sponsors",
    label: "Open sponsor CRM",
    detail: "Pair community narrative with recorded sponsor cash in the same season.",
    href: hubHref("/business", "sponsors", orgId),
  });

  actions.push({
    id: "first-dashboard",
    label: "Submit on FIRST Dashboard",
    detail: "Vantage stores evidence and essays. Awards still submit on FIRST's site — never a Vantage submit button.",
    href: "https://www.firstinspires.org/",
  });

  return actions.slice(0, 6);
}
