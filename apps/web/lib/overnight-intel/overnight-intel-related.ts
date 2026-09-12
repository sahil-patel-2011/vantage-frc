import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Related surfaces for Overnight brief (never DEMO overnight metrics). */
export const OVERNIGHT_INTEL_RELATED_LINKS = [
  { id: "command", label: "Event day", tab: "command" },
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "epa-trend-alerts", label: "Rating alerts", tab: "epa-trend-alerts" },
] as const;

export type OvernightIntelRelatedId = (typeof OVERNIGHT_INTEL_RELATED_LINKS)[number]["id"];

export type OvernightIntelRelatedLink = {
  id: OvernightIntelRelatedId;
  label: string;
  href: string;
};

/** Focused header strip — Event day / Strategy / Scouting. */
export const OVERNIGHT_INTEL_RELATED_INCLUDE: OvernightIntelRelatedId[] = [
  "command",
  "strategy",
  "scouting",
];

/**
 * Cross-links from Overnight brief → Event day / Strategy / Scouting.
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

export type OvernightIntelSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function overnightRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    overnightIntelRelatedLinks(orgId, { include: [...OVERNIGHT_INTEL_RELATED_INCLUDE] }).map(
      (link) => link.href,
    ),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = overnightRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

/** One setup primary — Event day / Strategy / Scouting live on the related strip. */
export function overnightIntelSetupSteps(
  orgId?: string | null,
  options?: { needsActiveEvent?: boolean },
): OvernightIntelSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open the overnight brief.",
        href: "/workspace",
      },
    ];
  }
  if (options?.needsActiveEvent) {
    return [
      {
        id: "active-event",
        label: "Set active event",
        detail: "Set the event you are at so this brief can show what changed overnight.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open the overnight brief.",
      href: withOrgHref("/workspace", orgId),
    },
  ];
}

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

/** Classify Overnight brief shell — never invents DEMO overnight metrics. */
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

/** Empty / setup / error copy — never DEMO overnight metrics, never org jargon. */
export function overnightIntelShellCopy(kind: OvernightIntelShellKind): OvernightIntelEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading overnight brief…",
        description: "Checking which team you are on and the event you are at.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load overnight brief",
        description:
          "A network or server issue blocked the brief. Retry, or open Event day while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team and set the event you are at before this morning brief can run.",
      };
    case "empty":
      return {
        kind,
        badge: "Nothing new yet",
        title: "Save tonight's brief when you are ready",
        description:
          "Empty sections mean no new public notes, season-score changes, or scouting since last night.",
      };
    case "ready":
      return {
        kind,
        title: "What changed overnight",
        description:
          "This brief lists only new public notes, season-score movers, and new scout rows.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Next actions for Overnight brief. Empty/setup keep one EmptyState primary;
 * the panel paints only on ready and never repeats the header strip.
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
    return setupActionsFrom(
      overnightIntelSetupSteps(orgId, { needsActiveEvent: input.needsActiveEvent }),
    );
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "ready":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: briefCount > 0 ? "review-brief" : "generate",
          label: briefCount > 0 ? "Review latest brief" : "Save tonight's brief",
          detail:
            briefCount > 0
              ? `${briefCount} saved brief${briefCount === 1 ? "" : "s"} from real overnight changes.`
              : `${signalCount} live change${signalCount === 1 ? "" : "s"} ready to save.`,
          href: briefCount > 0 ? "#overnight-intel-summary" : "#overnight-intel-generate",
          primary: true,
        },
        {
          id: "epa-trend-alerts",
          label: "Open rating alerts",
          detail: "Watch longer season-score swings beside overnight movers.",
          href: hubHref("/competition", "epa-trend-alerts", orgId),
        },
      ]);
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}
