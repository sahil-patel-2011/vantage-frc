import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Outreach Calendar (never DEMO reach metrics). */
export const OUTREACH_CALENDAR_RELATED_LINKS = [
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "media-kit", label: "Media Kit", kind: "business" as const, tab: "media-kit" },
  { id: "fundraisers", label: "Fundraisers", kind: "business" as const, tab: "fundraisers" },
  { id: "sponsor-suite", label: "Sponsor Suite", kind: "business" as const, tab: "sponsor-suite" },
] as const;

export type OutreachCalendarRelatedId = (typeof OUTREACH_CALENDAR_RELATED_LINKS)[number]["id"];

export type OutreachCalendarRelatedLink = {
  id: OutreachCalendarRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Impact / Media Kit / Fundraisers. */
export const OUTREACH_CALENDAR_RELATED_INCLUDE: OutreachCalendarRelatedId[] = [
  "impact",
  "media-kit",
  "fundraisers",
];

/**
 * Soft-UI cross-links from Outreach Calendar → Impact / Media Kit / Fundraisers.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function outreachCalendarRelatedLinks(
  orgId?: string | null,
  options?: { active?: OutreachCalendarRelatedId; include?: OutreachCalendarRelatedId[] },
): OutreachCalendarRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return OUTREACH_CALENDAR_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/business", link.tab, orgId),
  }));
}

export type OutreachCalendarShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type OutreachCalendarNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OutreachCalendarEmptyCopy = {
  kind: OutreachCalendarShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO reach metrics. */
export type OutreachCalendarSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function outreachCalendarSetupSteps(orgId?: string | null): OutreachCalendarSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — outreach plans are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "schedule",
      label: "Schedule an outreach event",
      detail: "Events stay blank until you add them — nothing is pre-seeded.",
      href: orgId ? withOrgHref("/outreach-calendar", orgId) : "/outreach-calendar",
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Logged impact stays empty until real evidence lands — never invent DEMO hours.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "media-kit",
      label: "Open Media Kit",
      detail: "Media assets stay blank until you record them — never DEMO logos.",
      href: hubHref("/business", "media-kit", orgId),
    },
  ];
}

/** Real event / hours counts only — never invent DEMO totals. */
export function formatOutreachCalendarMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is scheduled — avoids DEMO counters. */
export function shouldShowOutreachCalendarSummaryTiles(eventCount: number): boolean {
  return eventCount > 0;
}

/** True when the workspace has no outreach events yet — Soft-UI empty. */
export function isOutreachCalendarBoardEmpty(input: { eventCount: number }): boolean {
  return input.eventCount === 0;
}

/** Classify Outreach Calendar Soft-UI shell — never invents DEMO reach metrics. */
export function classifyOutreachCalendarShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eventCount?: number;
}): OutreachCalendarShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (isOutreachCalendarBoardEmpty({ eventCount: input.eventCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO reach metrics. */
export function outreachCalendarShellCopy(kind: OutreachCalendarShellKind): OutreachCalendarEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Outreach Calendar…",
        description:
          "Checking workspace membership and scheduled events — never DEMO reach metrics.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the Outreach Calendar",
        description:
          "A network or server issue blocked the calendar. Retry, or open Community Impact / Media Kit while it reloads — never invent DEMO hours.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Outreach Calendar is org-scoped. Pick a workspace and schedule real events before projecting hours — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No events yet",
        title: "Schedule your first outreach event",
        description:
          "Hours and reach stay blank until you schedule real events. Cross-check Community Impact and Media Kit — never DEMO reach metrics.",
      };
    default:
      return {
        kind: "ready",
        title: "Planned outreach",
        description:
          "Projections use only events you schedule — never invent DEMO hours or reach.",
      };
  }
}

/**
 * Soft-UI next actions for Outreach Calendar empty/setup shells.
 * Points at schedule / Impact / Media Kit — never invents DEMO reach metrics.
 */
export function outreachCalendarNextActions(input: {
  orgId?: string | null;
  shell: OutreachCalendarShellKind;
  eventCount?: number;
}): OutreachCalendarNextAction[] {
  const orgId = input.orgId ?? null;
  const eventCount = input.eventCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Outreach plans are org-scoped — pick a team before scheduling events.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "impact",
          label: "Open Community Impact",
          detail: "Logged impact stays blank until real evidence lands — never DEMO hours.",
          href: hubHref("/business", "impact", null),
        },
        {
          id: "media-kit",
          label: "Open Media Kit",
          detail: "Media assets stay empty until you record them — never invent DEMO logos.",
          href: hubHref("/business", "media-kit", null),
        },
      ];
    }
    return outreachCalendarSetupSteps(orgId).map((step, index) => ({
      ...step,
      primary: index === 0,
    }));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Outreach Calendar",
        detail: "Reload real scheduled events — nothing is invented while this fails.",
        href: withOrgHref("/outreach-calendar", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact log stays available while the calendar reloads.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "media-kit",
        label: "Open Media Kit",
        detail: "Media Kit stays available while the calendar reloads.",
        href: hubHref("/business", "media-kit", orgId),
      },
    ];
  }

  if (input.shell === "empty" || eventCount === 0) {
    return [
      {
        id: "schedule",
        label: "Schedule an event",
        detail: "Events stay blank until you add them — never invent DEMO reach.",
        href: "#outreach-calendar-schedule",
        primary: true,
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Log completed outreach as real evidence — never DEMO hours.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "media-kit",
        label: "Open Media Kit",
        detail: "Pair outreach with real media assets — never invent DEMO logos.",
        href: hubHref("/business", "media-kit", orgId),
      },
    ];
  }

  const actions: OutreachCalendarNextAction[] = [
    {
      id: "schedule-more",
      label: "Schedule another event",
      detail: `${eventCount} event${eventCount === 1 ? "" : "s"} scheduled — only real projections.`,
      href: "#outreach-calendar-schedule",
      primary: true,
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Convert completed events into logged impact evidence.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "media-kit",
      label: "Open Media Kit",
      detail: "Keep press assets grounded in recorded logos and bios.",
      href: hubHref("/business", "media-kit", orgId),
    },
    {
      id: "fundraisers",
      label: "Open Fundraisers",
      detail: "Align fundraising outreach with real campaign progress.",
      href: hubHref("/business", "fundraisers", orgId),
    },
  ];

  return actions.slice(0, 5);
}
