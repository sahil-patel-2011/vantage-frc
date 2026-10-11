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
  /** Finance manager (0714): may record proceeds. */
  canManageMoney?: boolean;
  /** Anyone but a view-only member may plan events. Defaults to canManageMoney. */
  canPlanEvents?: boolean;
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
        label: "Choose your team",
        detail: "Choose your team before planning fundraiser events.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: FundraisersNextAction[] = [];
  const eventCount = ctx.eventCount ?? 0;
  const totalGoal = ctx.totalGoalUsd ?? 0;
  const totalRaised = ctx.totalRaisedUsd ?? 0;

  const canPlan = ctx.canPlanEvents ?? ctx.canManageMoney;
  if (eventCount === 0) {
    actions.push({
      id: "first-event",
      label: canPlan ? "Plan your first fundraiser" : "Wait for a teammate to plan events",
      detail: canPlan
        ? "Add a car wash, bottle drive, or sale — raised $ stays blank until a finance manager records proceeds."
        : "Team members plan events and finance managers record deposits. You can still open Sponsors and Grants.",
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
      label: ctx.canManageMoney ? "Record real proceeds" : "Ask a finance manager to record proceeds",
      detail: "Deposit amounts post straight to team finance.",
      href: withOrgHref("/fundraisers", orgId),
      primary: true,
    });
  }

  if (totalGoal <= 0 && eventCount > 0) {
    actions.push({
      id: "event-goals",
      label: "Set event goals",
      detail: "Attainment % appears only after you enter a goal on an event.",
      href: withOrgHref("/fundraisers", orgId),
      primary: actions.length === 0,
    });
  }

  actions.push({
    id: "sponsors",
    label: "Open Sponsors",
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
