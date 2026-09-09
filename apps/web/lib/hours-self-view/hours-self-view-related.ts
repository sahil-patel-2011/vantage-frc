import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for My Hours (never DEMO hour totals). */
export const HOURS_SELF_VIEW_RELATED_LINKS = [
  { id: "attendance", label: "Attendance", tab: "attendance" },
  { id: "mentor-hours", label: "Mentor Hours", tab: "mentor-hours" },
  { id: "team-health-dashboard", label: "Team Health", tab: "team-health-dashboard" },
  { id: "goals-tracker", label: "Season Goals", tab: "goals-tracker" },
] as const;

export type HoursSelfViewRelatedId = (typeof HOURS_SELF_VIEW_RELATED_LINKS)[number]["id"];

export type HoursSelfViewRelatedLink = {
  id: HoursSelfViewRelatedId;
  label: string;
  href: string;
};

export const HOURS_SELF_VIEW_RELATED_INCLUDE: HoursSelfViewRelatedId[] = [
  "attendance",
  "mentor-hours",
  "team-health-dashboard",
];

/**
 * Soft-UI cross-links from My Hours → Attendance / Mentor Hours / Team Health.
 * Build with hubHref — never broken JSX href templates.
 */
export function hoursSelfViewRelatedLinks(
  orgId?: string | null,
  options?: { active?: HoursSelfViewRelatedId; include?: HoursSelfViewRelatedId[] },
): HoursSelfViewRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return HOURS_SELF_VIEW_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type HoursSelfViewShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type HoursSelfViewNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type HoursSelfViewEmptyCopy = {
  kind: HoursSelfViewShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type HoursSelfViewSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function hoursSelfViewSetupSteps(orgId?: string | null): HoursSelfViewSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — hour logs are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Clock in from attendance / build-hours so this self-view has real sessions.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "consent",
      label: "Open Consent",
      detail: "Guardian biometric consent stays blank until recorded.",
      href: withOrgHref("/consent", orgId),
    },
    {
      id: "mentor-hours",
      label: "Open Mentor Hours",
      detail: "Mentor engagement sits beside student self-view totals.",
      href: hubHref("/team", "mentor-hours", orgId),
    },
  ];
}

/** Real session / hour counts only — never invent DEMO totals. */
export function formatHoursSelfViewMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hours with one decimal from real minutes — blank until loaded; never DEMO hours. */
export function formatHoursSelfViewHours(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return `${Math.round(n * 10) / 10}`;
}

/** Hide zeroed summary tiles when no sessions exist — avoids DEMO counters. */
export function shouldShowHoursSelfViewSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** Classify My Hours Soft-UI shell — never invents DEMO hour totals. */
export function classifyHoursSelfViewShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): HoursSelfViewShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO hour totals. */
export function hoursSelfViewShellCopy(kind: HoursSelfViewShellKind): HoursSelfViewEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading My Hours…",
        description: "Checking workspace membership and your hour logs.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load My Hours",
        description:
          "A network or server issue blocked your hours. Retry, or open Attendance while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "My Hours is org-scoped. Pick a workspace before reading your logged sessions — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No hours yet",
        title: "Clock in to start your record",
        description:
          "Shop, meeting, and outreach sessions appear here after real clock-ins.",
      };
    default:
      return {
        kind: "ready",
        title: "Your logged hours",
        description: "Sessions from your clock-ins only.",
      };
  }
}

/**
 * Soft-UI next actions for My Hours empty/setup shells.
 * Points at Attendance / Consent / Mentor Hours — never invents DEMO hour totals.
 */
export function hoursSelfViewNextActions(input: {
  orgId?: string | null;
  shell: HoursSelfViewShellKind;
  entryCount?: number;
  kioskCount?: number;
}): HoursSelfViewNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const kioskCount = input.kioskCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Hour logs are org-scoped — pick a team before reading your sessions.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "attendance",
          label: "Open Attendance",
          detail: "Clock-ins stay blank until attendance is configured.",
          href: hubHref("/team", "attendance", null),
        },
        {
          id: "mentor-hours",
          label: "Open Mentor Hours",
          detail: "Mentor engagement stays empty until mentors log time.",
          href: hubHref("/team", "mentor-hours", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so My Hours can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Clock in so this self-view has real sessions.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "consent",
        label: "Open Consent",
        detail: "Biometric gates stay honest until guardian consent is recorded.",
        href: withOrgHref("/consent", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry My Hours",
        detail: "Reload your real hour logs — nothing is invented while this fails.",
        href: withOrgHref("/hours-self-view", orgId),
        primary: true,
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Attendance stays available while My Hours reloads.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "team-health-dashboard",
        label: "Open Team Health",
        detail: "Team Health stays available while My Hours reloads.",
        href: hubHref("/team", "team-health-dashboard", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "attendance",
        label: "Clock in from Attendance",
        detail: "Sessions stay blank until you log a real clock-in.",
        href: hubHref("/team", "attendance", orgId),
        primary: true,
      },
      {
        id: "consent",
        label: "Open Consent",
        detail: "Guardian biometric consent stays blank until recorded.",
        href: withOrgHref("/consent", orgId),
      },
      {
        id: "mentor-hours",
        label: "Open Mentor Hours",
        detail: "Mentor engagement sits beside student self-view.",
        href: hubHref("/team", "mentor-hours", orgId),
      },
    ];
  }

  return [
    {
      id: "review-sessions",
      label: "Review recent sessions",
      detail: `${entryCount} session${entryCount === 1 ? "" : "s"} from your clock-ins.`,
      href: "#hours-self-entries",
      primary: true,
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Clock in or out for the next session.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: kioskCount > 0 ? "review-kiosks" : "team-health",
      label: kioskCount > 0 ? "Review kiosk devices" : "Open Team Health",
      detail:
        kioskCount > 0
          ? `${kioskCount} kiosk device${kioskCount === 1 ? "" : "s"} registered.`
          : "Season health sits beside your personal hours.",
      href: kioskCount > 0 ? "#hours-self-kiosks" : hubHref("/team", "team-health-dashboard", orgId),
    },
    {
      id: "mentor-hours",
      label: "Open Mentor Hours",
      detail: "Cross-check mentor engagement beside student hours.",
      href: hubHref("/team", "mentor-hours", orgId),
    },
  ];
}
