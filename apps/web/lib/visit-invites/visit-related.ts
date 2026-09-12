import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Visit Invites (never DEMO invites). */
export const VISIT_RELATED_LINKS = [
  { id: "logistics", label: "Logistics", kind: "path" as const, path: "/logistics" },
  { id: "command", label: "Event day", kind: "competition" as const, tab: "command" },
  { id: "calendar", label: "Calendar", kind: "team" as const, tab: "calendar" },
  { id: "my-day", label: "My Day", kind: "competition" as const, tab: "my-day" },
] as const;

export type VisitRelatedId = (typeof VISIT_RELATED_LINKS)[number]["id"];

export type VisitRelatedLink = {
  id: VisitRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Logistics / Event day / Calendar first. */
export const VISIT_RELATED_INCLUDE: VisitRelatedId[] = [
  "logistics",
  "command",
  "calendar",
];

/** Cross-links for Visit Invites Soft-UI (never DEMO invite placeholders). */
export function visitRelatedLinks(
  orgId?: string | null,
  options?: { active?: VisitRelatedId; include?: VisitRelatedId[] },
): VisitRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return VISIT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type VisitShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type VisitNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Org-scoped Visit Invites board URL — never a DEMO seed path. */
export function visitInvitesShareHref(orgId?: string | null, visitId?: string | null): string {
  const base = withOrgHref("/visit-invites", orgId);
  if (!visitId) return base;
  const hash = `visit-${visitId}`;
  return base.includes("#") ? base : `${base}#${hash}`;
}

/**
 * Soft-UI next actions for Visit Invites empty/setup shells.
 * Points at real Logistics / Event day / Calendar paths — never DEMO invites.
 */
export function visitNextActions(input: {
  orgId?: string | null;
  shell: VisitShellKind;
  canManage?: boolean;
  visitCount?: number;
  hostGaps?: number;
}): VisitNextAction[] {
  const orgId = input.orgId ?? null;
  const visitCount = input.visitCount ?? 0;
  const canManage = Boolean(input.canManage);

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before scheduling shop tours.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "calendar",
          label: "Open Calendar",
          detail: "Outreach nights live on Team Calendar once a team is selected.",
          href: hubHref("/team", "calendar", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership or migration setup so Visit Invites can resolve your org.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "logistics",
        label: "Open Logistics",
        detail: "Travel and lodging stay on Logistics while shop tours and guest days live here.",
        href: withOrgHref("/logistics", orgId),
      },
      {
        id: "command",
        label: "Open Event day",
        detail: "Day-of command uses competition context separately from outreach visits.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Visit Invites",
        detail: "Reload real scheduled visits.",
        href: visitInvitesShareHref(orgId),
        primary: true,
      },
      {
        id: "logistics",
        label: "Open Logistics",
        detail: "Trip plans may still load if this board fetch failed.",
        href: withOrgHref("/logistics", orgId),
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Synced visit blocks appear on Team Calendar after mentors schedule them.",
        href: hubHref("/team", "calendar", orgId),
      },
    ];
  }

  if (input.shell === "empty" || visitCount === 0) {
    if (canManage) {
      return [
        {
          id: "create",
          label: "Create the first visit",
          detail: "Use the form on this page — Draft stays planner-only; Scheduled opens RSVPs.",
          href: visitInvitesShareHref(orgId) + "#visit-create",
          primary: true,
        },
        {
          id: "calendar",
          label: "Check Calendar sync",
          detail: "Optional calendar sync places real outreach blocks next to practice nights.",
          href: hubHref("/team", "calendar", orgId),
        },
        {
          id: "logistics",
          label: "Open Logistics",
          detail: "Event travel stays separate from shop tours and guest demo days.",
          href: withOrgHref("/logistics", orgId),
        },
        {
          id: "command",
          label: "Open Event day",
          detail: "Competition day-of tools are next door when guests visit during an event.",
          href: hubHref("/competition", "command", orgId),
        },
      ].slice(0, 4);
    }
    return [
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Mentors publish shop tours here — empty means none are scheduled yet.",
        href: hubHref("/team", "calendar", orgId),
        primary: true,
      },
      {
        id: "logistics",
        label: "Open Logistics",
        detail: "Trip lodging and leave times live on Logistics when an event is booked.",
        href: withOrgHref("/logistics", orgId),
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal competition timing stays on My Day while outreach visits RSVP here.",
        href: hubHref("/competition", "my-day", orgId),
      },
    ];
  }

  const actions: VisitNextAction[] = [];
  if ((input.hostGaps ?? 0) > 0 && canManage) {
    actions.push({
      id: "hosts",
      label: `Assign missing hosts (${input.hostGaps})`,
      detail: "Guests need a mentor host before arrival — assign names on each open visit card.",
      href: visitInvitesShareHref(orgId),
      primary: true,
    });
  }

  actions.push({
    id: "share",
    label: canManage ? "Share the visits board" : "Open visits board",
    detail: canManage
      ? "Copy the org link, sync to Calendar, or point guests at a Scheduled visit."
      : "RSVP on real scheduled visits when mentors publish them.",
    href: visitInvitesShareHref(orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "calendar",
    label: "Open Calendar",
    detail: "Synced shop tours and demo days show as outreach blocks on Team Calendar.",
    href: hubHref("/team", "calendar", orgId),
  });

  actions.push({
    id: "logistics",
    label: "Open Logistics",
    detail: "Hotels and travel legs stay on Logistics alongside Event day ops.",
    href: withOrgHref("/logistics", orgId),
  });

  if (actions.length < 4) {
    actions.push({
      id: "command",
      label: "Open Event day",
      detail: "Pit and command tools for competition days when visitors overlap an event.",
      href: hubHref("/competition", "command", orgId),
    });
  }

  return actions.slice(0, 4);
}

/** Classify Visit Invites Soft-UI shell from API status — never invents DEMO invites. */
export function classifyVisitShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  visitCount?: number;
}): VisitShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && input.status == null) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status !== "ready") return "error";
  if ((input.visitCount ?? 0) === 0) return "empty";
  return "ready";
}

export type VisitEmptyCopy = {
  kind: VisitShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO invites. */
export type VisitSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function visitSetupSteps(orgId?: string | null): VisitSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Visit Invites.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "create",
      label: "Schedule a visit",
      detail: "Draft stays planner-only; Scheduled opens RSVPs.",
      href: visitInvitesShareHref(orgId) + "#visit-create",
    },
    {
      id: "logistics",
      label: "Open Logistics",
      detail: "Competition hotels and leave times stay on Logistics, separate from shop tours.",
      href: withOrgHref("/logistics", orgId),
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Optional calendar sync places real outreach blocks next to practice nights.",
      href: hubHref("/team", "calendar", orgId),
    },
  ];
}

/** Soft-UI empty / setup / error copy — never DEMO invites. */
export function visitShellCopy(kind: VisitShellKind): VisitEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading visit invites…",
        description: "Checking which team you are on and scheduled shop tours.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load visit invites",
        description:
          "A network or server issue blocked the board. Retry, or open Logistics / Event day / Calendar while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Finish setup for visit invites",
        description:
          "Choose your team and apply the visit invites migration if tables are missing.",
      };
    case "empty":
      return {
        kind,
        badge: "No visits yet",
        title: "No shop tours or demo days yet",
        description:
          "Mentors schedule real outreach visits here. Empty means none are published.",
      };
    default:
      return {
        kind,
        title: "Visit Invites",
        description: "Shop tours, demo days, mentor hosts, and guest RSVPs from real visit rows.",
      };
  }
}
