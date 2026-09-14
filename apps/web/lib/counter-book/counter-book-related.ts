import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Opponent Counter-book (never DEMO opponent metrics). */
export const COUNTER_BOOK_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "opponent-watchlist", label: "Opponent Watchlist", tab: "opponent-watchlist" },
  { id: "defense-planner", label: "Defense Planner", tab: "defense-planner" },
] as const;

export type CounterBookRelatedId = (typeof COUNTER_BOOK_RELATED_LINKS)[number]["id"];

export type CounterBookRelatedLink = {
  id: CounterBookRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Scouting first. */
export const COUNTER_BOOK_RELATED_INCLUDE: CounterBookRelatedId[] = ["strategy", "scouting"];

/**
 * Soft-UI cross-links from Counter-book → Strategy / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function counterBookRelatedLinks(
  orgId?: string | null,
  options?: { active?: CounterBookRelatedId; include?: CounterBookRelatedId[] },
): CounterBookRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return COUNTER_BOOK_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type CounterBookShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type CounterBookNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CounterBookEmptyCopy = {
  kind: CounterBookShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real report counts only — never invent DEMO opponent totals. */
export function formatCounterBookMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is generated — avoids DEMO counters. */
export function shouldShowCounterBookSummaryTiles(reportCount: number): boolean {
  return reportCount > 0;
}

/** Classify Counter-book Soft-UI shell — never invents DEMO opponent metrics. */
export function classifyCounterBookShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  reportCount?: number;
}): CounterBookShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.reportCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO opponent metrics. */
export function counterBookShellCopy(kind: CounterBookShellKind): CounterBookEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Counter-book…",
        description:
          "Checking which team you are on and generated reports.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Counter-book",
        description:
          "A network or server issue blocked the report list. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before generating reports.",
      };
    case "empty":
      return {
        kind,
        badge: "No counter-books yet",
        title: "Generate your first opponent counter-book",
        description:
          "Scout a team's matches, then generate a report below. Tendencies come only from your scout rows. Cross-check Strategy and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Opponent counters from your scouting",
        description:
          "Reports use only scouted numeric tendencies for opponents you generated.",
      };
  }
}

/**
 * Soft-UI next actions for Counter-book empty/setup shells.
 * Points at Strategy / Scouting — never invents DEMO opponent metrics.
 */
export function counterBookNextActions(input: {
  orgId?: string | null;
  shell: CounterBookShellKind;
  reportCount?: number;
}): CounterBookNextAction[] {
  const orgId = input.orgId ?? null;
  const reportCount = input.reportCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before generating reports.",
          href: "/workspace",
          primary: true,
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
        detail: "Finish membership setup so Counter-book can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before generating opponent counters.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log match scouting so tendencies have real samples.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Counter-book",
        detail: "Reload real reports.",
        href: withOrgHref("/counter-book", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while reports reload.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while reports reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || reportCount === 0) {
    return [
      {
        id: "generate",
        label: "Generate a counter-book",
        detail: "Enter an opponent team key below — reports stay blank until scout samples exist.",
        href: "#counter-book-generate",
        primary: true,
      },
      {
        id: "scouting",
        label: "Log scouting first",
        detail: "Tendencies need real match scout rows.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Ground picks in scouted and reference metrics.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ].slice(0, 4);
  }

  return [
    {
      id: "generate-another",
      label: "Generate another report",
      detail: `${reportCount} report${reportCount === 1 ? "" : "s"} on file — add more opponents from scouted matches only.`,
      href: "#counter-book-generate",
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground picks in scouted data and reference metrics.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add more match rows to strengthen tendency samples.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "opponent-watchlist",
      label: "Open Opponent Watchlist",
      detail: "Pair qualitative notes with quantitative counter plans.",
      href: hubHref("/competition", "opponent-watchlist", orgId),
    },
  ].slice(0, 5);
}
