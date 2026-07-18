import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Decision Search (never DEMO decisions). */
export const DECISION_SEARCH_RELATED_LINKS = [
  { id: "season-report", label: "Season Report", kind: "ai" as const, tab: "season-report" },
  { id: "knowledge", label: "Knowledge", kind: "team" as const, tab: "knowledge" },
  { id: "strategy", label: "Strategy", kind: "path" as const, path: "/strategy" },
  { id: "decisions", label: "Decision Log", kind: "path" as const, path: "/decisions" },
  { id: "chat", label: "Chat", kind: "ai" as const, tab: "chat" },
  { id: "budgets", label: "Budgets", kind: "ai" as const, tab: "budgets" },
] as const;

export type DecisionSearchRelatedId = (typeof DECISION_SEARCH_RELATED_LINKS)[number]["id"];

export type DecisionSearchRelatedLink = {
  id: DecisionSearchRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Season Report / Knowledge / Strategy first. */
export const DECISION_SEARCH_RELATED_INCLUDE: DecisionSearchRelatedId[] = [
  "season-report",
  "knowledge",
  "strategy",
];

/**
 * Soft-UI cross-links from Decision Search → Season Report / Knowledge / Strategy.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function decisionSearchRelatedLinks(
  orgId?: string | null,
  options?: { active?: DecisionSearchRelatedId; include?: DecisionSearchRelatedId[] },
): DecisionSearchRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DECISION_SEARCH_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type DecisionSearchShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DecisionSearchNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DecisionSearchEmptyCopy = {
  kind: DecisionSearchShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real index counts only — never invent DEMO document totals. */
export function formatDecisionSearchMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Match % from real overlap scores only — blank until a search returns. */
export function formatDecisionSearchMatchPct(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Classify Decision Search Soft-UI shell — never invents DEMO decisions. */
export function classifyDecisionSearchShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  documentCount?: number;
}): DecisionSearchShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.documentCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO decisions. */
export function decisionSearchShellCopy(kind: DecisionSearchShellKind): DecisionSearchEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Decision Search…",
        description: "Checking workspace membership and the indexed corpus — never DEMO decisions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Decision Search",
        description:
          "A network or server issue blocked the index. Retry, or open Budgets if metered search is cut off.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Decision Search is org-scoped. Pick a workspace before indexing decisions, design reviews, or notebook entries — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No documents indexed",
        title: "Index your first record",
        description:
          "Search stays blank until you index real decisions or import from the Decision Log. Season Report, Knowledge, and Strategy stay linked for context — never DEMO decisions.",
      };
    default:
      return {
        kind: "ready",
        title: "Search indexed decisions",
        description:
          "Results come only from documents you indexed this season. Term overlap ranks matches — nothing is invented.",
      };
  }
}

/**
 * Soft-UI next actions for Decision Search empty/setup shells.
 * Points at Season Report / Knowledge / Strategy — never invents DEMO decisions.
 */
export function decisionSearchNextActions(input: {
  orgId?: string | null;
  shell: DecisionSearchShellKind;
  documentCount?: number;
  queryCount?: number;
}): DecisionSearchNextAction[] {
  const orgId = input.orgId ?? null;
  const documentCount = input.documentCount ?? 0;
  const queryCount = input.queryCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Indexed decisions are org-scoped — pick a team before searching.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "season-report",
          label: "Open Season Report",
          detail: "Season notes stay empty until you log real entries — never DEMO stats.",
          href: hubHref("/ai", "season-report", null),
        },
        {
          id: "knowledge",
          label: "Open Knowledge",
          detail: "Wiki pages stay blank until authored — never DEMO articles.",
          href: hubHref("/team", "knowledge", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick desks stay empty until real competition data exists.",
          href: withOrgHref("/strategy", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Decision Search can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "season-report",
        label: "Open Season Report",
        detail: "Retrospective notes stay separate from this searchable index.",
        href: hubHref("/ai", "season-report", orgId),
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Team wiki procedures complement indexed design decisions.",
        href: hubHref("/team", "knowledge", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Competition strategy stays grounded in match data, not invented decisions.",
        href: withOrgHref("/strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Decision Search",
        detail: "Reload the real index — nothing is invented while this fails.",
        href: withOrgHref("/decision-search", orgId),
        primary: true,
      },
      {
        id: "budgets",
        label: "Open Budgets",
        detail: "If metered search hard-stopped, check plan allowance and credits.",
        href: hubHref("/ai", "budgets", orgId),
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Wiki stays available while Decision Search is down.",
        href: hubHref("/team", "knowledge", orgId),
      },
    ];
  }

  if (input.shell === "empty" || documentCount === 0) {
    return [
      {
        id: "index",
        label: "Index a record",
        detail: "Add a decision, design review, or notebook entry — only real text becomes searchable.",
        href: "#decision-search-index",
        primary: true,
      },
      {
        id: "import",
        label: "Import Decision Log",
        detail: "Pull this season’s Decision Log into the index — grounded fields only.",
        href: "#decision-search-index",
      },
      {
        id: "season-report",
        label: "Open Season Report",
        detail: "Log season narrative notes separately from the search corpus.",
        href: hubHref("/ai", "season-report", orgId),
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Author wiki pages that stay empty until you write them.",
        href: hubHref("/team", "knowledge", orgId),
      },
    ].slice(0, 4);
  }

  const actions: DecisionSearchNextAction[] = [];
  if (queryCount === 0) {
    actions.push({
      id: "search",
      label: "Run a search",
      detail: "Ask about climber tradeoffs, gear ratios, or reliability — matches only when terms overlap indexed text.",
      href: "#decision-search-query",
      primary: true,
    });
  }

  actions.push(
    {
      id: "season-report",
      label: "Open Season Report",
      detail: "Cross-check season narrative with indexed design choices — never DEMO stats.",
      href: hubHref("/ai", "season-report", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "knowledge",
      label: "Open Knowledge",
      detail: "Link procedures in the wiki next to searchable decisions.",
      href: hubHref("/team", "knowledge", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Use competition strategy alongside indexed design rationale.",
      href: withOrgHref("/strategy", orgId),
    },
  );

  return actions.slice(0, 4);
}
