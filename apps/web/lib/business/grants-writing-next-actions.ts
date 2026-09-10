import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type GrantsWritingNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type GrantsWritingNextActionContext = {
  orgId?: string | null;
  draftCount?: number;
  readyCount?: number;
  impactActivities?: number;
  communityHours?: number;
};

/**
 * Soft-UI next actions for grant writing.
 * Never invents DEMO award $, win rates, or funder amounts — only org-local paths.
 */
export function grantsWritingNextActions(ctx: GrantsWritingNextActionContext): GrantsWritingNextAction[] {
  const orgId = ctx.orgId ?? null;
  const actions: GrantsWritingNextAction[] = [];

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before composing grant narratives.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  if ((ctx.draftCount ?? 0) === 0) {
    actions.push({
      id: "compose",
      label: "Compose your first narrative",
      detail: "Guided need · impact · budget · timeline uses this org’s profile only — asks stay blank until you enter them.",
      href: withOrgHref("/team/grants", orgId),
      primary: true,
    });
  } else if ((ctx.readyCount ?? 0) === 0) {
    actions.push({
      id: "ready",
      label: "Mark a draft ready to submit",
      detail: "Status stays draft until a human reviews provenance and claims.",
      href: withOrgHref("/team/grants", orgId),
      primary: true,
    });
  }

  if ((ctx.impactActivities ?? 0) === 0 && (ctx.communityHours ?? 0) === 0) {
    actions.push({
      id: "impact",
      label: "Log community impact evidence",
      detail: "Activities and hours appear in provenance only after you record them.",
      href: withOrgHref("/impact", orgId),
      primary: actions.length === 0,
    });
  }

  actions.push({
    id: "pipeline",
    label: "Track applications in Business",
    detail: "Deadlines and awarded amounts come from applications you add.",
    href: hubHref("/business", "grants", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "sponsors",
    label: "Open sponsor CRM",
    detail: "Pair grant asks with recorded sponsor cash in the same season goal.",
    href: hubHref("/business", "sponsors", orgId),
  });

  actions.push({
    id: "fundraisers",
    label: "Open fundraisers",
    detail: "Campaign tracking stays alongside grants for this team only.",
    href: withOrgHref("/fundraisers", orgId),
  });

  actions.push({
    id: "writer",
    label: "Grant & sponsor writer",
    detail: "Metered AI pitches and grant answers hard-stop at plan cutoffs.",
    href: withOrgHref("/writer", orgId),
  });

  return actions.slice(0, 5);
}
