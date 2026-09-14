import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Season Report (never DEMO season stats). */
export const SEASON_REPORT_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "path" as const, path: "/strategy" },
  { id: "impact", label: "Impact", kind: "path" as const, path: "/impact" },
  { id: "decision-search", label: "Decision Search", kind: "ai" as const, tab: "decision-search" },
  { id: "chat", label: "Chat", kind: "ai" as const, tab: "chat" },
  { id: "budgets", label: "Budgets", kind: "ai" as const, tab: "budgets" },
  { id: "usage", label: "AI usage", kind: "path" as const, path: "/team/usage" },
] as const;

export type SeasonReportRelatedId = (typeof SEASON_REPORT_RELATED_LINKS)[number]["id"];

export type SeasonReportRelatedLink = {
  id: SeasonReportRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Impact / Decision Search first. */
export const SEASON_REPORT_RELATED_INCLUDE: SeasonReportRelatedId[] = [
  "strategy",
  "impact",
  "decision-search",
];

/**
 * Soft-UI cross-links from Season Report → Strategy / Impact first.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function seasonReportRelatedLinks(
  orgId?: string | null,
  options?: { active?: SeasonReportRelatedId; include?: SeasonReportRelatedId[] },
): SeasonReportRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SEASON_REPORT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type SeasonReportShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SeasonReportNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SeasonReportEmptyCopy = {
  kind: SeasonReportShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real count lines only — never invent DEMO season totals. */
export function formatSeasonReportMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Completeness % from real category coverage only — blank until loaded. */
export function formatSeasonReportCompleteness(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Classify Season Report Soft-UI shell — never invents DEMO season stats. */
export function classifySeasonReportShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): SeasonReportShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO season stats. */
export function seasonReportShellCopy(kind: SeasonReportShellKind): SeasonReportEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Season Report…",
        description: "Checking which team you are on and logged season entries.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Season Report",
        description:
          "A network or server issue blocked the retrospective. Retry, or open Budgets if metered snapshot generation is cut off.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging build, results, budget, or outreach notes.",
      };
    case "empty":
      return {
        kind,
        badge: "No entries yet",
        title: "Log your first season note",
        description:
          "Coverage and snapshots stay blank until you record real entries. Strategy and Impact stay linked for context.",
      };
    default:
      return {
        kind: "ready",
        title: "Season retrospective",
        description:
          "Narratives and completeness come only from logged entries. Generate a snapshot when you want a metered synthesis.",
      };
  }
}

/**
 * Soft-UI next actions for Season Report empty/setup shells.
 * Points at Strategy / Impact — never invents DEMO season stats.
 */
export function seasonReportNextActions(input: {
  orgId?: string | null;
  shell: SeasonReportShellKind;
  entryCount?: number;
  snapshotCount?: number;
}): SeasonReportNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const snapshotCount = input.snapshotCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging entries.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick desks stay empty until real competition data exists.",
          href: withOrgHref("/strategy", null),
        },
        {
          id: "impact",
          label: "Open Impact",
          detail: "Outreach hours stay blank until activities are logged in Community Impact.",
          href: withOrgHref("/impact", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Season Report can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Competition strategy stays separate from this retrospective log.",
        href: withOrgHref("/strategy", orgId),
      },
      {
        id: "impact",
        label: "Open Impact",
        detail: "Outreach notes here can later align with Community Impact activities.",
        href: withOrgHref("/impact", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Season Report",
        detail: "Reload real entries and snapshots.",
        href: withOrgHref("/season-report", orgId),
        primary: true,
      },
      {
        id: "budgets",
        label: "Open Budgets",
        detail: "If snapshot generation hard-stopped, check plan allowance and credits.",
        href: hubHref("/ai", "budgets", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy stays empty while this page is down.",
        href: withOrgHref("/strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "log",
        label: "Log a season entry",
        detail: "Build reliability, results, budget, outreach, or lessons — only real notes count.",
        href: "#season-report-log",
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Match strategy and pick desks stay grounded in competition data, not this log.",
        href: withOrgHref("/strategy", orgId),
      },
      {
        id: "impact",
        label: "Open Impact",
        detail: "Record outreach activities so Impact hours stay real alongside season notes.",
        href: withOrgHref("/impact", orgId),
      },
      {
        id: "decision-search",
        label: "Open Decision Search",
        detail: "Index design decisions separately.",
        href: hubHref("/ai", "decision-search", orgId),
      },
    ].slice(0, 4);
  }

  const actions: SeasonReportNextAction[] = [];
  if (snapshotCount === 0) {
    actions.push({
      id: "snapshot",
      label: "Generate retrospective",
      detail: "Metered synthesis from logged entries only — coverage stays incomplete until categories are filled.",
      href: "#season-report-snapshots",
      primary: true,
    });
  }

  actions.push(
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Use competition strategy alongside this season narrative.",
      href: withOrgHref("/strategy", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "impact",
      label: "Open Impact",
      detail: "Cross-check outreach notes with Community Impact activities.",
      href: withOrgHref("/impact", orgId),
    },
    {
      id: "decision-search",
      label: "Open Decision Search",
      detail: "Search indexed decisions that fed this season’s choices.",
      href: hubHref("/ai", "decision-search", orgId),
    },
  );

  return actions.slice(0, 4);
}
