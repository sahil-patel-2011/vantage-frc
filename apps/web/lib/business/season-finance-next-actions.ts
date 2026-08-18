import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type SeasonFinanceNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SeasonFinanceNextActionContext = {
  orgId?: string | null;
  seasonYear?: number;
  fundingCount?: number;
  purchaseCount?: number;
  plannedSpendCents?: number;
  remainingToRaiseCents?: number;
  reimbursementOpenCents?: number;
  canManageFinance?: boolean;
};

/**
 * Soft-UI next actions for the season finance desk.
 * Never invents DEMO dollars — only points at real funding / purchase / sponsor paths.
 */
export function seasonFinanceNextActions(ctx: SeasonFinanceNextActionContext): SeasonFinanceNextAction[] {
  const orgId = ctx.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before planning season money.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const season = ctx.seasonYear;
  const withSeason = (href: string) =>
    season && Number.isFinite(season) ? `${href}${href.includes("?") ? "&" : "?"}season=${season}` : href;
  const financeHref = withSeason(hubHref("/business", "finance", orgId));
  const actions: SeasonFinanceNextAction[] = [];
  const fundingCount = ctx.fundingCount ?? 0;
  const purchaseCount = ctx.purchaseCount ?? 0;

  if (fundingCount === 0) {
    actions.push({
      id: "first-funding",
      label: ctx.canManageFinance ? "Add school funds, fees, or expected grants" : "Ask a finance lead to add funding lines",
      detail: "Planned vs received stays blank until someone logs a real source.",
      href: financeHref,
      primary: true,
    });
  } else if ((ctx.remainingToRaiseCents ?? 0) > 0) {
    actions.push({
      id: "gap",
      label: "Close the remaining funding gap",
      detail: "Received cash is still short of planned spend from logged rows only — record deposits or open sponsors.",
      href: financeHref,
      primary: true,
    });
  }

  if (purchaseCount === 0) {
    actions.push({
      id: "first-purchase",
      label: "Log a receipt or reimbursement",
      detail: "The purchase log starts empty. Amazon approvals still live under Orders — do not invent spend here.",
      href: financeHref,
      primary: actions.length === 0,
    });
  } else if ((ctx.reimbursementOpenCents ?? 0) > 0) {
    actions.push({
      id: "reimburse",
      label: "Clear open reimbursements",
      detail: "Receipts marked reimbursement stay open until a finance lead records the repay date.",
      href: financeHref,
      primary: actions.length === 0,
    });
  }

  if ((ctx.plannedSpendCents ?? 0) <= 0) {
    actions.push({
      id: "budget",
      label: "Set category allocations",
      detail: "Planned spend uses Business · Budget categories, or the season operating budget if none exist.",
      href: hubHref("/business", "budget", orgId),
    });
  }

  actions.push({
    id: "sponsors",
    label: "Open sponsor CRM",
    detail: "Cash already logged as sponsor contributions rolls into this desk — do not re-enter those deposits.",
    href: hubHref("/business", "sponsors", orgId),
  });
  actions.push({
    id: "orders",
    label: "Open purchase orders",
    detail: "Approved Amazon / buy-link requests stay on Orders. Use the purchase log for receipts and reimbursements.",
    href: hubHref("/business", "orders", orgId),
  });
  actions.push({
    id: "fundraisers",
    label: "Open fundraisers",
    detail: "Event proceeds recorded on Fundraisers count as received income on this desk.",
    href: withOrgHref("/fundraisers", orgId),
  });

  return actions.slice(0, 5);
}
