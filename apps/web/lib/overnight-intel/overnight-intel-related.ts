import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Overnight Event-Intel Brief (never DEMO overnight metrics). */
export const OVERNIGHT_INTEL_RELATED_LINKS = [
  { id: "command", label: "Command", tab: "command" },
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "epa-trend-alerts", label: "EPA Trend Alerts", tab: "epa-trend-alerts" },
] as const;

export type OvernightIntelRelatedId = (typeof OVERNIGHT_INTEL_RELATED_LINKS)[number]["id"];

export type OvernightIntelRelatedLink = {
  id: OvernightIntelRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Command / Strategy / Scouting first. */
export const OVERNIGHT_INTEL_RELATED_INCLUDE: OvernightIntelRelatedId[] = [
  "command",
  "strategy",
  "scouting",
];

/**
 * Soft-UI cross-links from Overnight Intel → Command / Strategy / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function overnightIntelRelatedLinks(
  orgId?: string | null,
  options?: { active?: OvernightIntelRelatedId; include?: OvernightIntelRelatedId[] },
): OvernightIntelRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return OVERNIGHT_INTEL_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type OvernightIntelShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type OvernightIntelNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OvernightIntelEmptyCopy = {
  kind: OvernightIntelShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real brief / signal counts only — never invent DEMO overnight totals. */
export function formatOvernightIntelMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function overnightIntelSignalCount(signals?: {
  researchHighlights?: unknown[];
  epaMovers?: unknown[];
  scoutingHighlights?: unknown[];
} | null): number {
  if (!signals) return 0;
  return (
    (signals.researchHighlights?.length ?? 0) +
    (signals.epaMovers?.length ?? 0) +
    (signals.scoutingHighlights?.length ?? 0)
  );
}

/** Hide zeroed summary tiles when nothing changed overnight — avoids DEMO counters. */
export function shouldShowOvernightIntelSummaryTiles(briefCount: number, signalCount: number): boolean {
  return briefCount > 0 || signalCount > 0;
}

/** Classify Overnight Intel Soft-UI shell — never invents DEMO overnight metrics. */
export function classifyOvernightIntelShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  briefCount?: number;
  signalCount?: number;
}): OvernightIntelShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.briefCount ?? 0) === 0 && (input.signalCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO overnight metrics. */
export function overnightIntelShellCopy(kind: OvernightIntelShellKind): OvernightIntelEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Overnight Intel…",
        description:
          "Checking workspace membership and active event — never DEMO overnight digests.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Overnight Intel",
        description:
          "A network or server issue blocked the brief. Retry, or open Command / Strategy while it reloads — never invent DEMO overnight metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Finish workspace and event setup",
        description:
          "Overnight Intel needs an org and active event. Pick a workspace and set your event — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No overnight changes yet",
        title: "Generate tonight's brief when ready",
        description:
          "Empty sections mean no research, EPA, or scouting changed since the last check-in — never DEMO digests. Cross-check Command, Strategy, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "What changed overnight",
        description:
          "Briefs summarize only real research findings, EPA movers, and new scout rows — never DEMO overnight metrics.",
      };
  }
}

/**
 * Soft-UI next actions for Overnight Intel empty/setup shells.
 * Points at Command / Strategy / Scouting — never invents DEMO overnight metrics.
 */
export function overnightIntelNextActions(input: {
  orgId?: string | null;
  shell: OvernightIntelShellKind;
  briefCount?: number;
  signalCount?: number;
  needsActiveEvent?: boolean;
}): OvernightIntelNextAction[] {
  const orgId = input.orgId ?? null;
  const briefCount = input.briefCount ?? 0;
  const signalCount = input.signalCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Overnight briefs are org-scoped — pick a team before compiling digests.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "command",
          label: "Open Command",
          detail: "Event Day stays blank until real schedule data exists — never DEMO matches.",
          href: hubHref("/competition", "command", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist — never DEMO rankings.",
          href: hubHref("/competition", "strategy", null),
        },
      ];
    }
    if (input.needsActiveEvent) {
      return [
        {
          id: "active-event",
          label: "Set active event",
          detail: "Choose the event you are competing at before generating overnight digests.",
          href: withOrgHref("/team/data", orgId),
          primary: true,
        },
        {
          id: "command",
          label: "Open Command",
          detail: "Confirm schedule context once an active event is set.",
          href: hubHref("/competition", "command", orgId),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Event strategy stays available beside overnight digests.",
          href: hubHref("/competition", "strategy", orgId),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Overnight Intel can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Confirm event-day context before compiling digests.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm pick context beside overnight signals.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Overnight Intel",
        detail: "Reload real overnight signals — nothing is invented while this fails.",
        href: withOrgHref("/overnight-intel", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Event Day stays available while the brief reloads.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy stays available while the brief reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (briefCount === 0 && signalCount === 0)) {
    return [
      {
        id: "generate",
        label: "Generate tonight's brief",
        detail: "Snapshots stay blank until research, EPA, or scouting actually changes — never DEMO digests.",
        href: "#overnight-intel-generate",
        primary: true,
      },
      {
        id: "scouting",
        label: "Log scouting",
        detail: "New match rows appear in the overnight digest once logged.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Cross-check live event-day context beside overnight signals.",
        href: hubHref("/competition", "command", orgId),
      },
    ].slice(0, 4);
  }

  const actions: OvernightIntelNextAction[] = [
    {
      id: briefCount > 0 ? "review-brief" : "generate",
      label: briefCount > 0 ? "Review latest brief" : "Generate tonight's brief",
      detail:
        briefCount > 0
          ? `${briefCount} saved brief${briefCount === 1 ? "" : "s"} from real overnight signals — never DEMO digests.`
          : `${signalCount} live signal${signalCount === 1 ? "" : "s"} ready to snapshot — never invent DEMO changes.`,
      href: briefCount > 0 ? "#overnight-intel-summary" : "#overnight-intel-generate",
      primary: true,
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Carry overnight changes into event-day ops.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Update picks from real EPA and scout movement only.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "epa-trend-alerts",
      label: "Open EPA Trend Alerts",
      detail: "Watch longer-horizon EPA swings beside overnight movers.",
      href: hubHref("/competition", "epa-trend-alerts", orgId),
    },
  ];

  return actions.slice(0, 5);
}
