import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Match Note Timeline (never DEMO match metrics). */
export const MATCH_NOTES_TIMELINE_RELATED_LINKS = [
  { id: "schedule", label: "Schedule", kind: "path" as const, path: "/schedule" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "match-checklist", label: "Match checklist", kind: "hub" as const, tab: "match-checklist" },
] as const;

export type MatchNotesTimelineRelatedId = (typeof MATCH_NOTES_TIMELINE_RELATED_LINKS)[number]["id"];

export type MatchNotesTimelineRelatedLink = {
  id: MatchNotesTimelineRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Schedule / Strategy / Scouting first. */
export const MATCH_NOTES_TIMELINE_RELATED_INCLUDE: MatchNotesTimelineRelatedId[] = [
  "schedule",
  "strategy",
  "scouting",
];

/**
 * Soft-UI cross-links from Match Note Timeline → Schedule / Strategy / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function matchNotesTimelineRelatedLinks(
  orgId?: string | null,
  options?: { active?: MatchNotesTimelineRelatedId; include?: MatchNotesTimelineRelatedId[] },
): MatchNotesTimelineRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCH_NOTES_TIMELINE_RELATED_LINKS.filter((link) => {
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

export type MatchNotesTimelineShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchNotesTimelineNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchNotesTimelineEmptyCopy = {
  kind: MatchNotesTimelineShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real note / match counts only — never invent DEMO timeline totals. */
export function formatMatchNotesMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is logged — avoids looking like DEMO counters. */
export function shouldShowMatchNotesSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** Classify Match Note Timeline Soft-UI shell — never invents DEMO match metrics. */
export function classifyMatchNotesTimelineShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): MatchNotesTimelineShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO match metrics. */
export function matchNotesTimelineShellCopy(kind: MatchNotesTimelineShellKind): MatchNotesTimelineEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Match Note Timeline…",
        description:
          "Checking which team you are on and logged notes.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match Note Timeline",
        description:
          "A network or server issue blocked the timeline. Retry, or open Schedule / Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before logging clock-synced notes.",
      };
    case "empty":
      return {
        kind,
        badge: "No notes yet",
        title: "Log your first match note",
        description:
          "Timelines stay blank until you log a real note with the match clock. Cross-check Schedule, Strategy, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Clock-synced match notes",
        description:
          "Notes use only what your team logs against the match clock.",
      };
  }
}

/**
 * Soft-UI next actions for Match Note Timeline empty/setup shells.
 * Points at Schedule / Strategy / Scouting — never invents DEMO match metrics.
 */
export function matchNotesTimelineNextActions(input: {
  orgId?: string | null;
  shell: MatchNotesTimelineShellKind;
  entryCount?: number;
  matchCount?: number;
}): MatchNotesTimelineNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const matchCount = input.matchCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging clock times.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Match rows stay empty until real TBA/event data exists.",
          href: withOrgHref("/schedule", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Match Note Timeline can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Confirm event match labels before logging clock-synced notes.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Ground debriefs in scouted and reference metrics before logging clock notes.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Pair qualitative notes with real scout rows.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match Note Timeline",
        detail: "Reload real note rows.",
        href: withOrgHref("/match-notes-timeline", orgId),
        primary: true,
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Match schedule stays available while the timeline reloads.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the timeline reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while the timeline reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "log-note",
        label: "Log a match note",
        detail: "Add a note with the match clock — timelines stay blank until you log one.",
        href: "#match-notes-timeline-log",
        primary: true,
      },
      {
        id: "video-analysis",
        label: "Open Video",
        detail: "Confirmed video events show here as from-video evidence. Scouted cycle counts stay as the scouts entered them.",
        href: withOrgHref("/video-analysis", orgId),
      },
      {
        id: "schedule",
        label: "Cross-check Schedule",
        detail: "Use real match labels from the schedule.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Debriefs stay grounded in scouted and reference metrics.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Pair clock notes with real scout rows for film review.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ].slice(0, 5);
  }

  const actions: MatchNotesTimelineNextAction[] = [
    {
      id: "review-timelines",
      label: "Review match timelines",
      detail: `${entryCount} note${entryCount === 1 ? "" : "s"} across ${matchCount} match${matchCount === 1 ? "" : "es"} — logged against the real match clock.`,
      href: "#match-notes-timeline-list",
      primary: true,
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Keep match labels aligned with the live event schedule.",
      href: withOrgHref("/schedule", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground picks and debriefs in scouted data.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Cross-check clock notes against real scout rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];

  return actions.slice(0, 5);
}
