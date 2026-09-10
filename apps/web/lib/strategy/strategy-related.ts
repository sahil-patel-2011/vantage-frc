import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for main Strategy (never DEMO win rates). */
export const STRATEGY_RELATED_LINKS = [
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "coverage", label: "Scout coverage", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type StrategyRelatedId = (typeof STRATEGY_RELATED_LINKS)[number]["id"];

export type StrategyRelatedLink = {
  id: StrategyRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Pick desk · Scouting · Event Day. */
export const STRATEGY_RELATED_INCLUDE: StrategyRelatedId[] = [
  "pick-desk",
  "scouting",
  "command",
];

/**
 * Soft-UI cross-links from Strategy → Pick desk / Scouting / Event Day.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function strategyRelatedLinks(
  orgId?: string | null,
  options?: { active?: StrategyRelatedId; include?: StrategyRelatedId[] },
): StrategyRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return STRATEGY_RELATED_LINKS.filter((link) => {
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

export type StrategyShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type StrategyShellNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type StrategyEmptyCopy = {
  kind: StrategyShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO win rates. */
export type StrategyShellSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function strategyShellSetupSteps(orgId?: string | null): StrategyShellSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Strategy.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Event Day Command picks the TBA event Strategy and picks use.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Load The Blue Alliance and Statbotics rows for the event.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Match and pit entries deepen explainability once synced.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "First / second / third tiers stay blank until real event metrics exist.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
  ];
}

/** Real prediction / factor counts only — never invent DEMO totals. */
export function formatStrategyMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed win-rate tiles until a live match prediction exists. */
export function shouldShowStrategyWinRate(status: "live" | "empty" | "setup_required" | null): boolean {
  return status === "live";
}

/** Classify main Strategy Soft-UI shell — never invents DEMO win rates. */
export function classifyStrategyShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "empty" | "live" | null;
  orgId?: string | null;
}): StrategyShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (input.status === "empty") return "empty";
  if (input.status === "live") return "ready";
  return "error";
}

/** Soft-UI empty / setup / error copy — never DEMO win rates. */
export function strategyShellCopy(kind: StrategyShellKind): StrategyEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading strategy…",
        description: "Checking your team, event, and synced match data.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load strategy",
        description: "Could not load strategy. Retry, or open Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team, set the event you are at, then sync match data. This screen stays empty until then.",
      };
    case "empty":
      return {
        kind,
        badge: "No prediction yet",
        title: "Waiting on a real matchup",
        description:
          "Win chance stays blank until this event has a scheduled match and synced stats.",
      };
    default:
      return {
        kind: "ready",
        title: "Strategy",
        description: "Win/loss and pick lists use The Blue Alliance, Statbotics, and your scout notes.",
      };
  }
}

/**
 * Soft-UI next actions for Strategy empty/setup shells.
 * Points at Pick desk / Scouting / Event Day — never invents DEMO win rates.
 */
export function strategyNextActions(input: {
  orgId?: string | null;
  shell: StrategyShellKind;
  eventKey?: string | null;
  tbaConfigured?: boolean;
  hasMetrics?: boolean;
}): StrategyShellNextAction[] {
  const orgId = input.orgId ?? null;
  const eventKey = input.eventKey ?? null;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before loading event predictions.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick lists stay empty until this event has synced team stats.",
          href: withOrgHref("/strategy?tab=picks", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout notes stay empty until someone on your team enters them.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Set the event you are at from Command.",
          href: hubHref("/competition", "command", null),
        },
      ];
    }
    if (!eventKey) {
      return [
        {
          id: "command",
          label: "Set active event",
          detail: "Event Day Command picks the TBA event Strategy and picks use.",
          href: hubHref("/competition", "command", orgId),
          primary: true,
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Confirm event context before arranging first / second / third picks.",
          href: withOrgHref("/strategy?tab=picks", orgId),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout notes wait until an event is set.",
          href: hubHref("/competition", "scouting", orgId),
        },
        {
          id: "team-data",
          label: "Sync Team Data",
          detail: "Load The Blue Alliance and Statbotics once an event is selected.",
          href: withOrgHref("/team/data", orgId),
        },
      ];
    }
    return [
      {
        id: "team-data",
        label: "Sync Team Data",
        detail: "Strategy needs TBA/Statbotics rows before win probability can appear.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Arrange first / second / third from real event teams.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add match notes so explainability lands once metrics sync.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Confirm the synced event context day-of ops share.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry strategy",
        detail: "Reload real TBA/Statbotics match context.",
        href: hubHref("/competition", "strategy", orgId),
        primary: true,
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Pick lists stay available while matchup reloads.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout coverage stays available while strategy reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Day-of command stays available while strategy reloads.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    const needsReferenceData = input.tbaConfigured === false || input.hasMetrics === false;
    // When reference data is already loaded the primary action IS Event Day, so
    // the trailing "Open Event Day" below would be the same id and the same href
    // listed twice — "Check Event Day schedule" over "Open Event Day".
    return [
      needsReferenceData
        ? {
            id: "team-data",
            label: "Sync event metrics",
            detail:
              "Load The Blue Alliance and Statbotics for this event. Win chance stays blank until then.",
            href: withOrgHref("/team/data", orgId),
            primary: true,
          }
        : {
            id: "command",
            label: "Check Event Day schedule",
            detail: "Confirm a scheduled match for your team.",
            href: hubHref("/competition", "command", orgId),
            primary: true,
          },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Pick tiers wait on the same reference rows.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add match notes so factors deepen once a matchup loads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      ...(needsReferenceData
        ? [
            {
              id: "command",
              label: "Open Event Day",
              detail: "Confirm the active event and schedule sync status.",
              href: hubHref("/competition", "command", orgId),
            },
          ]
        : []),
    ];
  }

  return [
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Arrange first / second / third picks from the same real event pool.",
      href: withOrgHref("/strategy?tab=picks", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Deepen matchup explainability with membership-bound scout rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Pit queues and readiness share this event context.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "draft",
      label: "Open Draft board",
      detail: "Run draft day from the same event team pool.",
      href: withOrgHref("/strategy/draft", orgId),
    },
  ];
}
