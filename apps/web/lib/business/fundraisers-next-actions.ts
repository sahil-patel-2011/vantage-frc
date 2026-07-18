import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type FundraisersNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type FundraisersNextActionContext = {
  orgId?: string | null;
  canManageMoney?: boolean;
  eventCount?: number;
  activeCount?: number;
  plannedCount?: number;
  totalGoalUsd?: number;
  totalRaisedUsd?: number;
};

/**
 * Soft-UI next actions for team fundraiser events.
 * Never invents DEMO raised totals — only points at real plans / CRM / grants / orders.
 */
export function fundraisersNextActions(ctx: FundraisersNextActionContext): FundraisersNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before planning fundraiser events.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: FundraisersNextAction[] = [];
  const eventCount = ctx.eventCount ?? 0;
  const totalGoal = ctx.totalGoalUsd ?? 0;
  const totalRaised = ctx.totalRaisedUsd ?? 0;

  if (eventCount === 0) {
    actions.push({
      id: "first-event",
      label: ctx.canManageMoney ? "Plan your first fundraiser" : "Wait for a lead to plan events",
      detail: ctx.canManageMoney
        ? "Add a car wash, bottle drive, or sale — raised $ stays blank until someone records proceeds."
        : "Owners and admins add events and deposit totals. You can still open Sponsors and Grants.",
      href: withOrgHref("/fundraisers", orgId),
      primary: true,
    });
  } else if ((ctx.plannedCount ?? 0) > 0 && (ctx.activeCount ?? 0) === 0) {
    actions.push({
      id: "activate",
      label: "Mark an event active",
      detail: "Move a planned fundraiser to active when the team is running it.",
      href: withOrgHref("/fundraisers", orgId),
      primary: true,
    });
  } else if (totalRaised <= 0 && (ctx.activeCount ?? 0) + (ctx.plannedCount ?? 0) > 0) {
    actions.push({
      id: "record",
      label: ctx.canManageMoney ? "Record real proceeds" : "Ask a lead to record proceeds",
      detail: "Deposit amounts post to team finance — totals never invent DEMO raised dollars.",
      href: withOrgHref("/fundraisers", orgId),
      primary: true,
    });
  }

  if (totalGoal <= 0 && eventCount > 0) {
    actions.push({
      id: "event-goals",
      label: "Set event goals",
      detail: "Attainment % appears only after you enter a goal on an event — not a placeholder bar.",
      href: withOrgHref("/fundraisers", orgId),
      primary: actions.length === 0,
    });
  }

  actions.push({
    id: "sponsors",
    label: "Open sponsor CRM",
    detail: "Season goal vs actual blends recorded sponsor cash with grant awards.",
    href: hubHref("/business", "sponsors", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "grants",
    label: "Track grant applications",
    detail: "Awarded dollars count toward season actuals only after you record them.",
    href: hubHref("/business", "grants", orgId),
  });

  actions.push({
    id: "orders",
    label: "Review purchase orders",
    detail: "Spend against funds you actually raised — open Business Orders.",
    href: hubHref("/business", "orders", orgId),
  });

  return actions.slice(0, 5);
}
