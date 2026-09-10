import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type CostsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CostsNextActionContext = {
  orgId?: string | null;
  seasonYear?: number;
  costCount?: number;
  subscriptionCount?: number;
  budgetUsd?: number | null;
  overBudget?: boolean;
};

/**
 * Soft-UI next actions for Season Costs.
 * Never invents DEMO season spend — only points at real budget / orders / fundraising paths.
 */
export function costsNextActions(ctx: CostsNextActionContext): CostsNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before tracking season spend.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const costsHref = withOrgHref("/costs", orgId);
  const season = ctx.seasonYear;
  const withSeason = (href: string) =>
    season && Number.isFinite(season) ? `${href}${href.includes("?") ? "&" : "?"}season=${season}` : href;

  const actions: CostsNextAction[] = [];
  const costCount = ctx.costCount ?? 0;
  const subscriptionCount = ctx.subscriptionCount ?? 0;
  const budgetUsd = ctx.budgetUsd ?? null;

  if (budgetUsd == null) {
    actions.push({
      id: "set-budget",
      label: "Set a season budget",
      detail: "Remaining and % used stay blank until you enter a real budget.",
      href: withSeason(costsHref),
      primary: true,
    });
  } else if (costCount === 0 && subscriptionCount === 0) {
    actions.push({
      id: "first-cost",
      label: "Log your first real-world cost",
      detail: "Registration, event fees, and parts start at $0 until you record them — totals are not placeholders.",
      href: withSeason(costsHref),
      primary: true,
    });
  } else if (ctx.overBudget) {
    actions.push({
      id: "over-budget",
      label: "Review committed spend",
      detail: "Committed costs exceed your season budget from logged rows only — trim plans or raise the ceiling.",
      href: withSeason(costsHref),
      primary: true,
    });
  }

  actions.push({
    id: "orders",
    label: "Open purchase orders",
    detail: "Approved Amazon / buy-link requests live under Orders — they are not invented on this page.",
    href: hubHref("/business", "orders", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "fundraisers",
    label: "Open fundraisers",
    detail: "Raised proceeds stay empty until someone records deposits — pair income with season spend.",
    href: withOrgHref("/fundraisers", orgId),
  });

  actions.push({
    id: "budget",
    label: "Open Business · Budget",
    detail: "Category allocations and purchase approvals stay on the Business hub — separate from Season Costs.",
    href: hubHref("/business", "budget", orgId),
  });

  return actions.slice(0, 5);
}
