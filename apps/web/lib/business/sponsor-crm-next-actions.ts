import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type SponsorCrmSurface = "sponsors" | "placements";

export type SponsorCrmNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SponsorCrmNextActionContext = {
  orgId?: string | null;
  surface: SponsorCrmSurface;
  canManage?: boolean;
  sponsorCount?: number;
  reminderCount?: number;
  fundraisingGoalCents?: number;
  packageCount?: number;
  campaignCount?: number;
  storefrontConfigured?: boolean;
  pendingSubmissionCount?: number;
  migrationMissing?: boolean;
};

/**
 * Readable next actions for Soft-UI sponsor CRM / partner placements.
 * Never invents DEMO revenue, fit scores, or pipeline counts — only points at real setup paths.
 */
export function sponsorCrmNextActions(ctx: SponsorCrmNextActionContext): SponsorCrmNextAction[] {
  const orgId = ctx.orgId ?? null;
  const actions: SponsorCrmNextAction[] = [];

  if (!orgId) {
    actions.push({
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization before loading sponsors or packages.",
      href: "/workspace",
      primary: true,
    });
    return actions;
  }

  if (ctx.migrationMissing) {
    actions.push({
      id: "migration",
      label: "Apply partner migrations",
      detail: "Partner packages and storefront tables are missing for this environment.",
      href: hubHref("/business", "placements", orgId),
      primary: true,
    });
    return actions;
  }

  if (ctx.surface === "sponsors") {
    if ((ctx.fundraisingGoalCents ?? 0) <= 0) {
      actions.push({
        id: "goal",
        label: "Set a season fundraising goal",
        detail: "Budget goal drives goal-vs-actual — progress only reflects recorded cash and grants.",
        href: hubHref("/business", "budget", orgId),
        primary: true,
      });
    }

    if ((ctx.sponsorCount ?? 0) === 0) {
      actions.push({
        id: "add-sponsor",
        label: ctx.canManage ? "Add your first sponsor" : "Wait for a finance lead",
        detail: ctx.canManage
          ? "Start partners in Prospect, then move them through ask → visit → pledged → active."
          : "Owners and admins add CRM rows. You can still open Fundraisers and Grants.",
        href: hubHref("/business", "sponsors", orgId),
        primary: (ctx.fundraisingGoalCents ?? 0) > 0,
      });
      actions.push({
        id: "fundraisers",
        label: "Open fundraisers",
        detail: "Track campaigns alongside the sponsor pipeline.",
        href: withOrgHref("/fundraisers", orgId),
      });
      actions.push({
        id: "grants",
        label: "Track grant applications",
        detail: "Grant awards count toward season actuals with sponsor cash.",
        href: hubHref("/business", "grants", orgId),
      });
    } else if ((ctx.reminderCount ?? 0) > 0) {
      actions.push({
        id: "reminders",
        label: `Clear ${ctx.reminderCount} CRM nudge${ctx.reminderCount === 1 ? "" : "s"}`,
        detail: "Thank-yous, renewals, and overdue follow-ups stay org-local.",
        href: hubHref("/business", "sponsors", orgId),
        primary: true,
      });
    } else {
      actions.push({
        id: "packages",
        label: "Publish recognition packages",
        detail: "Turn committed sponsors into approved placements — payment first.",
        href: hubHref("/business", "placements", orgId),
        primary: true,
      });
      actions.push({
        id: "orders",
        label: "Review purchase orders",
        detail: "Spend planning sits next to sponsor income in the same season.",
        href: hubHref("/business", "orders", orgId),
      });
      actions.push({
        id: "finance-ai",
        label: "Ask Finance-in-AI",
        detail: "Opt-in guidance on season costs — never card or bank details.",
        href: withOrgHref("/ai?tab=finance", orgId),
      });
    }
  }

  if (ctx.surface === "placements") {
    if ((ctx.sponsorCount ?? 0) === 0) {
      actions.push({
        id: "sponsors-first",
        label: "Add sponsors in CRM first",
        detail: "Packages attach to org sponsors — no cross-team package IDs.",
        href: hubHref("/business", "sponsors", orgId),
        primary: true,
      });
    }

    if ((ctx.packageCount ?? 0) === 0) {
      actions.push({
        id: "add-package",
        label: ctx.canManage ? "Create a placement package" : "Packages not published yet",
        detail: ctx.canManage
          ? "Price, duration, and surfaces stay inside this org workspace."
          : "Only owners and admins publish packages for the public storefront.",
        href: hubHref("/business", "placements", orgId),
        primary: (ctx.sponsorCount ?? 0) > 0,
      });
    }

    if (!ctx.storefrontConfigured && ctx.canManage) {
      actions.push({
        id: "storefront",
        label: "Configure the partner storefront",
        detail: "Pitch and direct payment link — money goes to the team, not Vantage.",
        href: hubHref("/business", "placements", orgId),
        primary: (ctx.packageCount ?? 0) > 0 && (ctx.sponsorCount ?? 0) > 0,
      });
    }

    if ((ctx.pendingSubmissionCount ?? 0) > 0) {
      actions.push({
        id: "inbox",
        label: `Review ${ctx.pendingSubmissionCount} inquiry${ctx.pendingSubmissionCount === 1 ? "" : "ies"}`,
        detail: "Nothing becomes a CRM row or placement until you approve it.",
        href: hubHref("/business", "placements", orgId),
        primary: true,
      });
    } else if ((ctx.packageCount ?? 0) > 0 && (ctx.campaignCount ?? 0) === 0 && (ctx.sponsorCount ?? 0) > 0) {
      actions.push({
        id: "campaign",
        label: "Create a draft placement",
        detail: "Record payment and approve artwork before recognition goes live.",
        href: hubHref("/business", "placements", orgId),
        primary: true,
      });
    }

    if (actions.length < 3) {
      actions.push({
        id: "finance-ai",
        label: "Ask Finance-in-AI",
        detail: "Season cost questions next to partner revenue planning.",
        href: withOrgHref("/ai?tab=finance", orgId),
      });
      actions.push({
        id: "fundraisers",
        label: "Open fundraisers",
        detail: "Campaign tracking alongside packaged placements.",
        href: withOrgHref("/fundraisers", orgId),
      });
    }
  }

  return actions.slice(0, 5);
}
