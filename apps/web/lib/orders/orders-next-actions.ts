import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type OrdersNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OrdersNextActionContext = {
  orgId?: string | null;
  isAdmin?: boolean;
  orderCount?: number;
  pendingCount?: number;
  readyToBuyCount?: number;
  missingBuyLinkCount?: number;
  seasonYear?: number;
};

/**
 * Soft-UI next actions for purchase requests.
 * Never invents DEMO order totals — only points at real approve → buy-link steps.
 */
export function ordersNextActions(ctx: OrdersNextActionContext): OrdersNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before submitting or approving purchases.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const ordersHref = withOrgHref("/orders", orgId);
  const businessOrdersHref = hubHref("/business", "orders", orgId);
  const season = ctx.seasonYear;
  const withSeason = (href: string) =>
    season && Number.isFinite(season) ? `${href}${href.includes("?") ? "&" : "?"}season=${season}` : href;

  const actions: OrdersNextAction[] = [];
  const orderCount = ctx.orderCount ?? 0;
  const pending = ctx.pendingCount ?? 0;
  const ready = ctx.readyToBuyCount ?? 0;
  const missingLinks = ctx.missingBuyLinkCount ?? 0;

  if (orderCount === 0) {
    actions.push({
      id: "submit",
      label: "Submit the first purchase need",
      detail:
        "Describe the part and estimate — mentors approve here, then buyers open the vendor link outside Vantage.",
      href: withSeason(ordersHref),
      primary: true,
    });
  } else if (pending > 0 && ctx.isAdmin) {
    actions.push({
      id: "approve",
      label: `Review ${pending} awaiting approval`,
      detail: "Approve unlocks the buy link for the assigned buyer. Card and bank details are never collected here.",
      href: withSeason(businessOrdersHref),
      primary: true,
    });
  } else if (pending > 0) {
    actions.push({
      id: "waiting",
      label: "Waiting on mentor approval",
      detail: `${pending} request${pending === 1 ? "" : "s"} still need an owner or admin before anyone can buy.`,
      href: withSeason(ordersHref),
      primary: true,
    });
  } else if (ready > 0 && missingLinks > 0) {
    actions.push({
      id: "buy-link",
      label: "Add missing buy links",
      detail: `${missingLinks} approved request${missingLinks === 1 ? "" : "s"} need a vendor product URL before ordering.`,
      href: withSeason(ordersHref),
      primary: true,
    });
  } else if (ready > 0) {
    actions.push({
      id: "buy",
      label: `Open buy link${ready === 1 ? "" : "s"} and order`,
      detail: "Pay on the vendor site, save the receipt, then mark ordered here — never paste card numbers into Vantage.",
      href: withSeason(ordersHref),
      primary: true,
    });
  }

  actions.push({
    id: "sponsors",
    label: "Open sponsor CRM",
    detail: "Sponsor cash you actually recorded funds the purchases mentors approve.",
    href: hubHref("/business", "sponsors", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "fundraisers",
    label: "Open fundraisers",
    detail: "Event proceeds post to finance when deposited — spend against real raised dollars.",
    href: withOrgHref("/fundraisers", orgId),
  });

  actions.push({
    id: "budget",
    label: "Check season budget",
    detail: "Approved and ordered amounts feed Business budget — no placeholder DEMO totals.",
    href: hubHref("/business", "budget", orgId),
  });

  return actions.slice(0, 5);
}
