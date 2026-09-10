import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Alliance Chemistry (never DEMO chemistry scores). */
export const CHEMISTRY_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
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

export function chemistrySetupSteps(orgId?: string | null): ChemistrySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open chemistry scores.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the TBA event your team is competing at — scores stay blank until synced.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull rankings from The Blue Alliance and Statbotics.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Confirm event context before scoring alliance fit.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Arrange first / second / third picks from real event teams before chemistry.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "draft",
      label: "Open Draft board",
      detail: "Run draft day on the same real event pool.",
      href: withOrgHref("/strategy/draft", orgId),
    },
  ];
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
        description:
          "Checking which team you are on and TBA/Statbotics event metrics.",
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
        badge: "Setup required",
        title: "Select a team and event",
        description:
          "Alliance chemistry is org- and event-scoped. Select a team and active TBA event before scores appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No chemistry score yet",
        title: "Waiting on real alliance seats",
        description:
          "Enter 2–3 team numbers (or wait for your next alliance on the schedule). Scores stay blank until TBA/Statbotics rows exist. Cross-check Strategy, Pick desk, and Draft.",
      };
    default:
      return {
        kind: "ready",
        title: "Alliance chemistry",
        description:
          "Partner fit from synced event ratings and scout reliability only. Verify with pit notes before locking picks.",
      };
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
  const seatCount = input.seatCount ?? 0;
  const hasScore = input.hasScore ?? false;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose a team before scoring alliances.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss and draft day stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick tiers stay blank until your team syncs event rows.",
          href: withOrgHref("/strategy?tab=picks", null),
        },
        {
          id: "draft",
          label: "Open Draft board",
          detail: "Alliance slots stay blank until synced.",
          href: withOrgHref("/strategy/draft", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Chemistry needs a TBA event before alliance seats can score.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before scoring alliance fit.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Arrange first / second / third picks from real event teams.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "draft",
        label: "Open Draft board",
        detail: "Run draft day on the same real event pool.",
        href: withOrgHref("/strategy/draft", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry chemistry",
        detail: "Reload real event metrics and seats.",
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
    ];
  }

  if (input.shell === "empty" || isChemistryScoreEmpty({ seatCount, hasScore })) {
    return [
      {
        id: "team-data",
        label: "Sync event metrics",
        detail:
          "Pull TBA/Statbotics team_event_metrics — chemistry scores stay blank until then.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Win/loss waits on the same reference rows.",
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
    ];
  }

  return [
    {
      id: "chemistry",
      label: "Review chemistry score",
      detail: `Partner fit across ${formatChemistryMetric(seatCount, true)} seat${seatCount === 1 ? "" : "s"} from synced ratings only.`,
      href: hubHref("/competition", "chemistry", orgId),
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Return to event strategy while evaluating alliance fit.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Cross-check first / second / third tiers against chemistry.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "draft",
      label: "Open Draft board",
      detail: "Carry the same real seats into draft day.",
      href: withOrgHref("/strategy/draft", orgId),
    },
  ];
}
