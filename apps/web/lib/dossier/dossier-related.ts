import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team Dossier (never DEMO stats). */
export const DOSSIER_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "intel", label: "Intel", kind: "path" as const, path: "/intel" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type DossierRelatedId = (typeof DOSSIER_RELATED_LINKS)[number]["id"];

export type DossierRelatedLink = {
  id: DossierRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Scouting · Pick desk. */
export const DOSSIER_RELATED_INCLUDE: DossierRelatedId[] = [
  "strategy",
  "scouting",
  "pick-desk",
];

/**
 * Soft-UI cross-links from Team Dossier → Strategy / Scouting / Pick desk.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function dossierRelatedLinks(
  orgId?: string | null,
  options?: { active?: DossierRelatedId; include?: DossierRelatedId[] },
): DossierRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DOSSIER_RELATED_LINKS.filter((link) => {
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

export type DossierShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DossierNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DossierEmptyCopy = {
  kind: DossierShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO stats. */
export type DossierSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function dossierSetupSteps(orgId?: string | null): DossierSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — dossiers are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull TBA identity + Statbotics EPA into Neon.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Confirm event context before citing season facts in picks.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add org scout notes so reliability / foul cards can appear.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Cross-check cited facts against first / second / third tiers.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
  ];
}

/** Real cited-fact counts only — never invent DEMO totals. */
export function formatDossierMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when no real fact cards — avoids DEMO stats. */
export function shouldShowDossierSummaryTiles(cardCount: number): boolean {
  return cardCount > 0;
}

/** True when there are no cited fact cards — Soft-UI empty until cache has facts. */
export function isDossierFactsEmpty(cardCount: number): boolean {
  return cardCount <= 0;
}

/** Classify Team Dossier Soft-UI shell — never invents DEMO stats. */
export function classifyDossierShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "empty" | "live" | null;
  orgId?: string | null;
  teamNumber?: number | null;
  cardCount?: number;
}): DossierShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (
    input.status === "empty" ||
    input.teamNumber == null ||
    isDossierFactsEmpty(input.cardCount ?? 0)
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO stats. */
export function dossierShellCopy(kind: DossierShellKind): DossierEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading season dossier…",
        description:
          "Checking workspace membership and TBA/Statbotics caches.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load team dossier",
        description:
          "A network or server issue blocked the fact load. Retry, or open Strategy / Scouting / Pick desk while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Season dossiers are org-scoped. Pick a workspace and sync TBA/Statbotics before cited facts appear — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No facts yet",
        title: "Waiting on cited season facts",
        description:
          "Enter a team number and sync TBA identity + Statbotics EPA. Cards stay blank until real rows exist. Cross-check Strategy, Scouting, and Pick desk.",
      };
    default:
      return {
        kind: "ready",
        title: "Season team dossier",
        description:
          "Cited TBA / Statbotics / org-scout facts only. Verify before locking picks.",
      };
  }
}

/**
 * Soft-UI next actions for Team Dossier empty/setup shells.
 * Points at Strategy / Scouting / Pick desk — never invents DEMO stats.
 */
export function dossierNextActions(input: {
  orgId?: string | null;
  shell: DossierShellKind;
  teamNumber?: number | null;
  cardCount?: number;
}): DossierNextAction[] {
  const orgId = input.orgId ?? null;
  const cardCount = input.cardCount ?? 0;
  const teamNumber = input.teamNumber ?? null;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Dossiers are org-scoped — choose a team before loading facts.",
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
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout notes stay blank until your team syncs entries.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick tiers stay blank until your team syncs event rows.",
          href: withOrgHref("/strategy?tab=picks", null),
        },
      ];
    }
    return [
      {
        id: "team-data",
        label: "Sync Team Data",
        detail: "Dossiers need TBA identity + Statbotics EPA before cards can cite facts.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before citing season facts in picks.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add org scout notes so reliability / foul cards can appear.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Arrange first / second / third picks from real event teams.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry dossier",
        detail: "Reload real TBA/Statbotics/scout facts — nothing is invented while this fails.",
        href: withOrgHref("/dossier", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the dossier reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout coverage stays available while the dossier reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Pick lists stay available while the dossier reloads.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
    ];
  }

  if (input.shell === "empty" || isDossierFactsEmpty(cardCount)) {
    return [
      {
        id: "team-data",
        label: "Sync season metrics",
        detail:
          "Pull TBA identity + Statbotics EPA — dossier cards stay blank until then.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Win/loss waits on the same Neon reference rows.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Org scout notes feed reliability / foul cards when present.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Link a real pick list before citing season facts — empty tiers stay empty.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
    ];
  }

  const dossierHref =
    teamNumber != null
      ? withOrgHref(`/dossier?team=${encodeURIComponent(String(teamNumber))}`, orgId)
      : withOrgHref("/dossier", orgId);

  return [
    {
      id: "dossier",
      label: "Review cited facts",
      detail: `${formatDossierMetric(cardCount, true)} cited fact card${cardCount === 1 ? "" : "s"} from TBA/Statbotics/scout only.`,
      href: dossierHref,
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Return to event strategy while evaluating this team.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Cross-check org scout notes against cited reliability cards.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Cross-check first / second / third tiers against dossier facts.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
  ];
}
