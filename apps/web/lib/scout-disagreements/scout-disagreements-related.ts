import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Disagreements (never DEMO conflicts). */
export const SCOUT_DISAGREEMENTS_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "coverage-live", label: "Coverage", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "command", label: "Event day", kind: "hub" as const, tab: "command" },
] as const;

export type ScoutDisagreementsRelatedId = (typeof SCOUT_DISAGREEMENTS_RELATED_LINKS)[number]["id"];

export type ScoutDisagreementsRelatedLink = {
  id: ScoutDisagreementsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Accuracy · Coverage. */
export const SCOUT_DISAGREEMENTS_RELATED_INCLUDE: ScoutDisagreementsRelatedId[] = [
  "scouting",
  "accuracy",
  "coverage",
];

/**
 * Soft-UI cross-links from Scout Disagreements → Scouting / Accuracy / Coverage.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function scoutDisagreementsRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutDisagreementsRelatedId; include?: ScoutDisagreementsRelatedId[] },
): ScoutDisagreementsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_DISAGREEMENTS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type ScoutDisagreementsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutDisagreementsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutDisagreementsEmptyCopy = {
  kind: ScoutDisagreementsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO conflicts. */
export type ScoutDisagreementsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutDisagreementsSetupSteps(orgId?: string | null): ScoutDisagreementsSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open disagreement review.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real overlapping match-scout fields — the queue stays blank until then.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "official ranks help decide which scout's value to trust when resolving.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Confirm lineup gaps so every robot has real scout rows that can disagree.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pin the event so disagreements stay tied to the matches you are scouting.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatScoutDisagreementsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when nothing is logged — avoids DEMO conflicts. */
export function shouldShowScoutDisagreementsSummaryTiles(input: {
  totalOpen: number;
  totalResolved: number;
  totalDismissed: number;
}): boolean {
  return input.totalOpen > 0 || input.totalResolved > 0 || input.totalDismissed > 0;
}

/** True when the resolution queue has no logged conflicts — Soft-UI empty. */
export function isScoutDisagreementsQueueEmpty(input: { itemCount: number }): boolean {
  return input.itemCount === 0;
}

/** Classify Scout Disagreements Soft-UI shell — never invents DEMO conflicts. */
export function classifyScoutDisagreementsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  itemCount?: number;
}): ScoutDisagreementsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isScoutDisagreementsQueueEmpty({ itemCount: input.itemCount ?? 0 })) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO conflicts. */
export function scoutDisagreementsShellCopy(kind: ScoutDisagreementsShellKind): ScoutDisagreementsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Disagreements",
        description:
          "Checking which team you are on and real conflict rows.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scout disagreements",
        description:
          "A network or server issue blocked the resolution queue. Retry, or open Scouting / Accuracy / Coverage while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before the resolution queue appears.",
      };
    case "empty":
      return {
        kind,
        badge: "No disagreements yet",
        title: "Waiting on real conflicting fields",
        description:
          "The queue stays blank until two scouts submit overlapping values for the same match/team/field. Cross-check Scouting, Accuracy, and Coverage.",
      };
    default:
      return {
        kind: "ready",
        title: "Resolution queue",
        description:
          "Resolve conflicting scouted field values with an immutable audit trail.",
      };
  }
}

/**
 * Soft-UI next actions for Scout Disagreements empty/setup shells.
 * Points at Scouting / Accuracy / Coverage — never invents DEMO conflicts.
 */
export function scoutDisagreementsNextActions(input: {
  orgId?: string | null;
  shell: ScoutDisagreementsShellKind;
  itemCount?: number;
  openCount?: number;
}): ScoutDisagreementsNextAction[] {
  const orgId = input.orgId ?? null;
  const openCount = input.openCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before resolving conflicts.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Conflicts stay blank until your team enters overlapping fields.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "accuracy",
          label: "Open Accuracy",
          detail: "official ranks stay honest until real scout rows exist.",
          href: withOrgHref("/scout-accuracy", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Lineup gaps stay honest until real assignments exist.",
          href: withOrgHref("/scouting/lineup", null),
        },
      ];
    }
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log overlapping match-scout fields so real conflicts can surface.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Use official ranks when choosing an authoritative value.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Fill lineup gaps so every robot has real scout rows.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "command",
        label: "Set active event",
        detail: "Confirm the event so disagreements stay match-scoped.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry scout disagreements",
        detail: "Reload real conflict rows.",
        href: withOrgHref("/scout-disagreements", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the queue reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Accuracy ranks stay available while disagreements reload.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Lineup coverage stays available while disagreements reload.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (input.itemCount ?? 0) === 0) {
    return [
      {
        id: "scouting",
        label: "Log scout entries",
        detail: "Conflicts appear only when two scouts overlap on a field.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Cross-check official ranks before you need to resolve.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Cover open lineup gaps so overlapping scout rows can appear.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "command",
        label: "Sync event day",
        detail: "Confirm the active event so logged conflicts stay on the right matches.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  return [
    {
      id: "queue",
      label:
        openCount > 0
          ? `Resolve ${openCount} open conflict${openCount === 1 ? "" : "s"}`
          : "Review resolution queue",
      detail:
        openCount > 0
          ? "Pick the authoritative value from real scout submissions."
          : "All logged conflicts are resolved or dismissed — keep scouting for new overlaps.",
      href: openCount > 0 ? "#disagreement-queue" : hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Keep logging this team's match entries for fresher conflicts.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Prefer scouts whose totals match official results when choosing an authoritative value.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Cross-check lineup gaps against fields that keep conflicting.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
  ];
}
