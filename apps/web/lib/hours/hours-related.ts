import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

export const HOURS_RELATED_LINKS = [
  { id: "attendance", label: "Attendance", kind: "team" as const, tab: "attendance" },
  { id: "hours-self-view", label: "My hours", kind: "team" as const, tab: "hours-self-view" },
  { id: "kiosk", label: "Shop kiosk", kind: "path" as const, path: "/hours/kiosk" },
] as const;

export type HoursRelatedId = (typeof HOURS_RELATED_LINKS)[number]["id"];

export type HoursRelatedLink = {
  id: HoursRelatedId;
  label: string;
  href: string;
};

export const HOURS_RELATED_INCLUDE: HoursRelatedId[] = [
  "attendance",
  "hours-self-view",
  "kiosk",
];

export function hoursRelatedLinks(
  orgId?: string | null,
  options?: { active?: HoursRelatedId; include?: HoursRelatedId[] },
): HoursRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return HOURS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type HoursShellKind = "loading" | "error" | "setup" | "ready";

export type HoursNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type HoursEmptyCopy = {
  kind: HoursShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type HoursSetupStep = { id: string; label: string; detail: string; href: string };

function hoursRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    hoursRelatedLinks(orgId, { include: [...HOURS_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = hoursRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function hoursCardPrimaryHref(orgId?: string | null): string {
  return orgId ? withOrgHref("/workspace", orgId) : "/workspace";
}

export const HOURS_PAGE_TITLE = "Shop hours";
export const HOURS_PAGE_BLURB =
  "Clock in and out of the shop, see who's here, and track hour goals.";

export function hoursSetupSteps(orgId?: string | null): HoursSetupStep[] {
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to clock in.",
      href: hoursCardPrimaryHref(orgId),
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Roll call sits beside shop hours.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My hours",
      detail: "Your own log stays on My hours.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
    {
      id: "kiosk",
      label: "Open shop kiosk",
      detail: "Shared shop tablet for scan-in.",
      href: withOrgHref("/hours/kiosk", orgId),
    },
  ]);
}

export function classifyHoursShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  orgId?: string | null;
}): HoursShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  return "ready";
}

export function hoursShellCopy(kind: HoursShellKind): HoursEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading shop hours…",
        description: "Checking which team you are on.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load shop hours",
        description: "A network or server issue blocked Hours. Retry, or open Attendance while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Select a team",
        description: "Select a team before clocking in.",
      };
    case "ready":
      return {
        kind,
        title: HOURS_PAGE_TITLE,
        description: "Clock in and out of the shop. Totals come from real clock-ins only.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function hoursNextActions(input: {
  orgId?: string | null;
  shell: HoursShellKind;
}): HoursNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(hoursSetupSteps(orgId));
  }
  switch (input.shell) {
    case "loading":
    case "ready":
      return [];
    case "error":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "retry",
          label: "Retry Hours",
          detail: "Reload shop hours.",
          href: withOrgHref("/hours", orgId),
          primary: true,
        },
        {
          id: "attendance",
          label: "Open Attendance",
          detail: "Roll call stays available while Hours reloads.",
          href: hubHref("/team", "attendance", orgId),
        },
        {
          id: "hours-self-view",
          label: "Open My hours",
          detail: "Your log stays available while Hours reloads.",
          href: hubHref("/team", "hours-self-view", orgId),
        },
        {
          id: "kiosk",
          label: "Open shop kiosk",
          detail: "The shared tablet stays available while Hours reloads.",
          href: withOrgHref("/hours/kiosk", orgId),
        },
      ]);
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}
