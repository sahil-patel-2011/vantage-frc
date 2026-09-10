import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team Intel / research (never DEMO research). */
export const INTEL_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "dossier", label: "Team Dossier", kind: "path" as const, path: "/dossier" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
  { id: "chemistry", label: "Alliance Chemistry", kind: "path" as const, path: "/chemistry" },
] as const;

export type IntelRelatedId = (typeof INTEL_RELATED_LINKS)[number]["id"];

export type IntelRelatedLink = {
  id: IntelRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Dossier · Scouting. */
export const INTEL_RELATED_INCLUDE: IntelRelatedId[] = ["strategy", "dossier", "scouting"];

/**
 * Soft-UI cross-links from Team Intel → Strategy / Dossier / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function intelRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: IntelRelatedId;
    include?: IntelRelatedId[];
    teamNumber?: number | null;
  },
): IntelRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  const teamNumber = options?.teamNumber ?? null;
  return INTEL_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.id === "dossier" && teamNumber != null) {
      return {
        id: link.id,
        label: link.label,
        href: withOrgHref(`/dossier?team=${encodeURIComponent(String(teamNumber))}`, orgId),
      };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type IntelShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type IntelNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type IntelEmptyCopy = {
  kind: IntelShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO research. */
export type IntelSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function intelSetupSteps(orgId?: string | null): IntelSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Intel and research.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull team identity and season numbers from The Blue Alliance and Statbotics.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Confirm event context before prioritizing teams.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "dossier",
      label: "Open Team Dossier",
      detail: "Cited season facts stay blank until real TBA/Statbotics rows exist.",
      href: withOrgHref("/dossier", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add org scout notes so reliability / foul context can appear.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

/** Real finding counts only — never invent DEMO research totals. */
export function formatIntelMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** True when no team is selected — Soft-UI empty until lookup. */
export function isIntelLookupEmpty(hasSelectedTeam: boolean): boolean {
  return !hasSelectedTeam;
}

/** Classify Team Intel Soft-UI shell — never invents DEMO research. */
export function classifyIntelShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  hasSelectedTeam?: boolean;
}): IntelShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  if (isIntelLookupEmpty(input.hasSelectedTeam ?? false)) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO research. */
export function intelShellCopy(kind: IntelShellKind): IntelEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Team Intel…",
        description:
          "Checking workspace membership and the global team index.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Team Intel",
        description:
          "A network or server issue blocked the lookup. Retry, or open Strategy / Dossier / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pick a workspace and sync TBA/Statbotics before metrics or findings appear.",
      };
    case "empty":
      return {
        kind,
        badge: "Look up a team",
        title: "Search the global team index",
        description:
          "Search by number or name to open metrics, research, and dossier links. Empty cells mean the cache has no data yet. Cross-check Strategy, Dossier, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Team Intel",
        description:
          "TBA/Statbotics metrics and source-linked research only. Verify before locking picks.",
      };
  }
}

/**
 * Soft-UI next actions for Team Intel empty/setup shells.
 * Points at Strategy / Dossier / Scouting — never invents DEMO research.
 */
export function intelNextActions(input: {
  orgId?: string | null;
  shell: IntelShellKind;
  teamNumber?: number | null;
  findingCount?: number;
}): IntelNextAction[] {
  const orgId = input.orgId ?? null;
  const teamNumber = input.teamNumber ?? null;
  const findingCount = input.findingCount ?? 0;
  const dossierHref =
    teamNumber != null
      ? withOrgHref(`/dossier?team=${encodeURIComponent(String(teamNumber))}`, orgId)
      : withOrgHref("/dossier", orgId);

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose a team before looking up research.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss stays empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "dossier",
          label: "Open Team Dossier",
          detail: "Cited facts stay blank until your team syncs TBA/Statbotics.",
          href: withOrgHref("/dossier", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout notes stay blank until your team syncs entries.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "team-data",
        label: "Sync Team Data",
        detail: "Intel needs TBA identity + Statbotics EPA before metrics can appear.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before prioritizing teams.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "dossier",
        label: "Open Team Dossier",
        detail: "Cited season facts stay blank until real rows exist.",
        href: withOrgHref("/dossier", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add org scout notes so reliability / foul context can appear.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Intel",
        detail: "Reload the global team index.",
        href: withOrgHref("/intel", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while Intel reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "dossier",
        label: "Open Team Dossier",
        detail: "Cited facts stay available while Intel reloads.",
        href: withOrgHref("/dossier", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout coverage stays available while Intel reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || isIntelLookupEmpty(teamNumber != null)) {
    return [
      {
        id: "team-data",
        label: "Sync season metrics",
        detail:
          "Pull TBA identity + Statbotics EPA — Intel metrics stay blank until then.",
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
        id: "dossier",
        label: "Open Team Dossier",
        detail: "Cited season facts stay blank until you look up a team.",
        href: withOrgHref("/dossier", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Org scout notes feed reliability / foul context when present.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  return [
    {
      id: "intel",
      label: "Review research findings",
      detail: `${formatIntelMetric(findingCount, true)} source-linked finding${findingCount === 1 ? "" : "s"}`,
      href:
        teamNumber != null
          ? withOrgHref(`/intel?team=${encodeURIComponent(String(teamNumber))}`, orgId)
          : withOrgHref("/intel", orgId),
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Return to event strategy while evaluating this team.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "dossier",
      label: "Open Team Dossier",
      detail: "Cross-check cited TBA/Statbotics/scout facts for this team.",
      href: dossierHref,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Cross-check org scout notes against reliability / foul evidence.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}
