import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Alliance Chemistry (never DEMO chemistry scores). */
export const CHEMISTRY_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "team-data", label: "Team data", kind: "path" as const, path: "/team/data" },
] as const;

export type ChemistryRelatedId = (typeof CHEMISTRY_RELATED_LINKS)[number]["id"];

export type ChemistryRelatedLink = {
  id: ChemistryRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Pick desk · Draft. */
export const CHEMISTRY_RELATED_INCLUDE: ChemistryRelatedId[] = [
  "strategy",
  "pick-desk",
  "draft",
];

/**
 * Soft-UI cross-links from Alliance Chemistry → Strategy / Pick desk / Draft.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function chemistryRelatedLinks(
  orgId?: string | null,
  options?: { active?: ChemistryRelatedId; include?: ChemistryRelatedId[] },
): ChemistryRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CHEMISTRY_RELATED_LINKS.filter((link) => {
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

export type ChemistryShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ChemistryNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ChemistryEmptyCopy = {
  kind: ChemistryShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO chemistry scores. */
export type ChemistrySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function chemistryRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    chemistryRelatedLinks(orgId, { include: [...CHEMISTRY_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = chemistryRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function chemistrySetupSteps(orgId?: string | null): ChemistrySetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open partner-fit scores.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — scores stay blank until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
}

/** Real seat / scored counts only — never invent DEMO totals. */
export function formatChemistryMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when no real seats are scored — avoids DEMO chemistry scores. */
export function shouldShowChemistrySummaryTiles(seatCount: number, hasScore: boolean): boolean {
  return seatCount >= 2 && hasScore;
}

/** True when fewer than 2 seats or no real score — Soft-UI empty until metrics exist. */
export function isChemistryScoreEmpty(input: {
  seatCount: number;
  hasScore: boolean;
}): boolean {
  return input.seatCount < 2 || !input.hasScore;
}

/** Classify Alliance Chemistry Soft-UI shell — never invents DEMO chemistry scores. */
export function classifyChemistryShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "empty" | "live" | null;
  orgId?: string | null;
  eventKey?: string | null;
  seatCount?: number;
  hasScore?: boolean;
}): ChemistryShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId || !input.eventKey) return "setup";
  if (
    input.status === "empty" ||
    isChemistryScoreEmpty({
      seatCount: input.seatCount ?? 0,
      hasScore: input.hasScore ?? false,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO chemistry scores. */
export function chemistryShellCopy(kind: ChemistryShellKind): ChemistryEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading alliance chemistry…",
        description: "Checking which team you are on and event ratings.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load alliance chemistry",
        description:
          "A network or server issue blocked the scorer. Retry, or open Strategy / Pick desk / Draft while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and the event this alliance is at before partner-fit scores appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No chemistry score yet",
        title: "Waiting on real alliance seats",
        description:
          "Enter 2–3 team numbers (or wait for your next alliance on the schedule). Scores stay blank until event ratings exist. Cross-check Strategy, Pick desk, and Draft.",
      };
    case "ready":
      return {
        kind,
        title: "Alliance chemistry",
        description:
          "Partner fit from synced event ratings and scout reliability only. Verify with pit notes before locking picks.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Soft-UI next actions for Alliance Chemistry empty/setup shells.
 * Points at Strategy / Pick desk / Draft — never invents DEMO chemistry scores.
 */
export function chemistryNextActions(input: {
  orgId?: string | null;
  shell: ChemistryShellKind;
  eventKey?: string | null;
  seatCount?: number;
  hasScore?: boolean;
}): ChemistryNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(chemistrySetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "ready":
      return [];
    case "error":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "retry",
          label: "Retry chemistry",
          detail: "Reload event ratings and seats.",
          href: hubHref("/competition", "chemistry", orgId),
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Event strategy stays available while chemistry reloads.",
          href: hubHref("/competition", "strategy", orgId),
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick lists stay available while chemistry reloads.",
          href: withOrgHref("/strategy?tab=picks", orgId),
        },
        {
          id: "draft",
          label: "Open Draft board",
          detail: "Draft day stays available while chemistry reloads.",
          href: withOrgHref("/strategy/draft", orgId),
        },
      ]);
    case "empty":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "team-data",
          label: "Sync Team data",
          detail: "Load match and ranking rows for this event. Partner-fit stays blank until then.",
          href: withOrgHref("/team/data", orgId),
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss waits on the same event rows.",
          href: hubHref("/competition", "strategy", orgId),
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Link a real pick list before scoring alliance fit — empty tiers stay empty.",
          href: withOrgHref("/strategy?tab=picks", orgId),
        },
        {
          id: "draft",
          label: "Open Draft board",
          detail: "Alliance slots use the same synced event pool.",
          href: withOrgHref("/strategy/draft", orgId),
        },
      ]);
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}
