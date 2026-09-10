import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Decision Log (never DEMO log entries). */
export const DECISIONS_RELATED_LINKS = [
  { id: "decision-search", label: "Decision Search", kind: "ai" as const, tab: "decision-search" },
  { id: "season-report", label: "Season Report", kind: "ai" as const, tab: "season-report" },
  { id: "knowledge", label: "Knowledge", kind: "team" as const, tab: "knowledge" },
  { id: "strategy", label: "Strategy", kind: "path" as const, path: "/strategy" },
  { id: "chat", label: "Chat", kind: "ai" as const, tab: "chat" },
  { id: "budgets", label: "Budgets", kind: "ai" as const, tab: "budgets" },
] as const;

export type DecisionsRelatedId = (typeof DECISIONS_RELATED_LINKS)[number]["id"];

export type DecisionsRelatedLink = {
  id: DecisionsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Decision Search / Season Report / Knowledge first. */
export const DECISIONS_RELATED_INCLUDE: DecisionsRelatedId[] = [
  "decision-search",
  "season-report",
  "knowledge",
];

/**
 * Soft-UI cross-links from Decision Log → Decision Search / Season Report / Knowledge.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function decisionsRelatedLinks(
  orgId?: string | null,
  options?: { active?: DecisionsRelatedId; include?: DecisionsRelatedId[] },
): DecisionsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DECISIONS_RELATED_LINKS.filter((link) => {
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

export type DecisionsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DecisionsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DecisionsEmptyCopy = {
  kind: DecisionsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real count lines only — never invent DEMO log totals. */
export function formatDecisionsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Decision Log Soft-UI shell — never invents DEMO log entries. */
export function classifyDecisionsShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  decisionCount?: number;
}): DecisionsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.decisionCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO log entries. */
export function decisionsShellCopy(kind: DecisionsShellKind): DecisionsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Decision Log…",
        description: "Checking which team you are on and logged decisions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the Decision Log",
        description:
          "A network or server issue blocked the log. Retry, or open Knowledge while Decision Log is down.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before recording engineering or strategy calls.",
      };
    case "empty":
      return {
        kind,
        badge: "No decisions yet",
        title: "Record your first call",
        description:
          "The log stays blank until you capture a real decision with context and rationale. Decision Search, Season Report, and Knowledge stay linked.",
      };
    default:
      return {
        kind: "ready",
        title: "Season decision log",
        description:
          "Entries come only from decisions your team recorded this season — proposed, accepted, rejected, or superseded. Nothing is invented.",
      };
  }
}

/**
 * Soft-UI next actions for Decision Log empty/setup shells.
 * Points at Decision Search / Season Report / Knowledge — never invents DEMO log entries.
 */
export function decisionsNextActions(input: {
  orgId?: string | null;
  shell: DecisionsShellKind;
  decisionCount?: number;
  openCount?: number;
}): DecisionsNextAction[] {
  const orgId = input.orgId ?? null;
  const decisionCount = input.decisionCount ?? 0;
  const openCount = input.openCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging calls.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "decision-search",
          label: "Open Decision Search",
          detail: "Search stays empty until you index real decisions.",
          href: hubHref("/ai", "decision-search", null),
        },
        {
          id: "season-report",
          label: "Open Season Report",
          detail: "Season notes stay blank until you log real entries.",
          href: hubHref("/ai", "season-report", null),
        },
        {
          id: "knowledge",
          label: "Open Knowledge",
          detail: "Wiki pages stay blank until authored.",
          href: hubHref("/team", "knowledge", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Decision Log can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "decision-search",
        label: "Open Decision Search",
        detail: "Index stays separate until you import grounded Decision Log fields.",
        href: hubHref("/ai", "decision-search", orgId),
      },
      {
        id: "season-report",
        label: "Open Season Report",
        detail: "Retrospective notes stay separate from this ADR-style log.",
        href: hubHref("/ai", "season-report", orgId),
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Team wiki procedures complement logged design decisions.",
        href: hubHref("/team", "knowledge", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Decision Log",
        detail: "Reload real decision records.",
        href: withOrgHref("/decisions", orgId),
        primary: true,
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Wiki stays available while Decision Log is down.",
        href: hubHref("/team", "knowledge", orgId),
      },
      {
        id: "decision-search",
        label: "Open Decision Search",
        detail: "Search the indexed corpus if you already imported records.",
        href: hubHref("/ai", "decision-search", orgId),
      },
    ];
  }

  if (input.shell === "empty" || decisionCount === 0) {
    return [
      {
        id: "record",
        label: "Record a decision",
        detail: "Capture context, options, the call, and rationale — only real text becomes a log entry.",
        href: "#decision-log-form",
        primary: true,
      },
      {
        id: "decision-search",
        label: "Open Decision Search",
        detail: "After you log decisions, import them into the searchable index.",
        href: hubHref("/ai", "decision-search", orgId),
      },
      {
        id: "season-report",
        label: "Open Season Report",
        detail: "Log season narrative notes separately from ADR-style decisions.",
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

  const actions: DecisionsNextAction[] = [];
  if (openCount > 0) {
    actions.push({
      id: "resolve",
      label: "Close open proposals",
      detail: `${openCount} proposed decision${openCount === 1 ? "" : "s"} still need a call — accept, reject, or supersede with real rationale.`,
      href: "#decision-log-open",
      primary: true,
    });
  }

  actions.push(
    {
      id: "decision-search",
      label: "Open Decision Search",
      detail: "Import grounded Decision Log fields into the searchable index.",
      href: hubHref("/ai", "decision-search", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "season-report",
      label: "Open Season Report",
      detail: "Cross-check season narrative with logged design choices.",
      href: hubHref("/ai", "season-report", orgId),
    },
    {
      id: "knowledge",
      label: "Open Knowledge",
      detail: "Link procedures in the wiki next to accepted decisions.",
      href: hubHref("/team", "knowledge", orgId),
    },
  );

  return actions.slice(0, 4);
}
