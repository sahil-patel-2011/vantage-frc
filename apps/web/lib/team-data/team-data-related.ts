import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team Data / TBA sync (never DEMO metrics). */
export const TEAM_DATA_RELATED_LINKS = [
  { id: "schedule", label: "Schedule", kind: "path" as const, path: "/schedule" },
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "strategy", label: "Strategy", kind: "path" as const, path: "/strategy" },
  { id: "exports", label: "Exports", kind: "path" as const, path: "/exports" },
  { id: "workspace", label: "Your team", kind: "path" as const, path: "/workspace" },
] as const;

export type TeamDataRelatedId = (typeof TEAM_DATA_RELATED_LINKS)[number]["id"];

export type TeamDataRelatedLink = {
  id: TeamDataRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Schedule / Event Day / Strategy first. */
export const TEAM_DATA_RELATED_INCLUDE: TeamDataRelatedId[] = [
  "schedule",
  "command",
  "strategy",
];

/** Cross-links for Team Data Soft-UI (never DEMO team metrics). */
export function teamDataRelatedLinks(
  orgId?: string | null,
  options?: { active?: TeamDataRelatedId; include?: TeamDataRelatedId[] },
): TeamDataRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return TEAM_DATA_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type TeamDataShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type TeamDataNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for Team Data empty/setup shells.
 * Points at real Schedule / Event Day / Strategy paths — never DEMO metrics.
 */
export function teamDataNextActions(input: {
  orgId?: string | null;
  shell: TeamDataShellKind;
  hasActiveEvent?: boolean;
  tbaConfigured?: boolean;
  matchCount?: number;
  metricCount?: number;
}): TeamDataNextAction[] {
  const orgId = input.orgId ?? null;
  const matchCount = input.matchCount ?? 0;
  const metricCount = input.metricCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before connecting credentials or an event.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Match boards stay empty until a team and active event sync real TBA rows.",
          href: withOrgHref("/schedule", null),
        },
      ];
    }

    if (input.hasActiveEvent === false) {
      return [
        {
          id: "workspace",
          label: "Set active event",
          detail: "Your team’s active event is what Team Data syncs — empty until you choose one.",
          href: withOrgHref("/workspace", orgId),
          primary: true,
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Confirm day-of context uses the same active event as TBA sync.",
          href: hubHref("/competition", "command", orgId),
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Qual and playoff rows appear after an event is selected and synced.",
          href: withOrgHref("/schedule", orgId),
        },
      ];
    }

    if (input.tbaConfigured === false) {
      return [
        {
          id: "team-data",
          label: "Save a TBA key",
          detail: "Save a Blue Alliance key here, or ask whoever set up this site to add one in deployment settings.",
          href: withOrgHref("/team/data", orgId),
          primary: true,
        },
        {
          id: "workspace",
          label: "Confirm active event",
          detail: "Sync still needs an event key even after a credential is saved.",
          href: withOrgHref("/workspace", orgId),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss stays blank until rankings from The Blue Alliance and Statbotics are saved.",
          href: withOrgHref("/strategy", orgId),
        },
      ];
    }

    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership or event setup so Team Data can resolve your org.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Day-of command uses the same active event this page syncs.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Match times come from the schedule this page saves.",
        href: withOrgHref("/schedule", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Team Data",
        detail: "Reload inventory and ranking health.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Last saved matches may still load if this event was synced before.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy stays empty while sync is down.",
        href: withOrgHref("/strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (matchCount === 0 && metricCount === 0)) {
    return [
      {
        id: "sync",
        label: "Sync active event",
        detail: "Pull matches and team numbers from The Blue Alliance.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "The match board stays blank until this sync lands real alliance rows.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Pit queue and coverage wait on the same TBA event cache.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desks and win/loss stay empty until metrics exist for this event.",
        href: withOrgHref("/strategy", orgId),
      },
    ].slice(0, 4);
  }

  return [
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Qual and playoff timing use the matches just synced for this event.",
      href: withOrgHref("/schedule", orgId),
      primary: true,
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Command center for pit ops tied to this event’s TBA schedule.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Win/loss and pick desks read the same saved rankings.",
      href: withOrgHref("/strategy", orgId),
    },
    {
      id: "exports",
      label: "Open Exports",
      detail: "Audited CSV/PDF/ZIP of real inventory.",
      href: withOrgHref("/exports", orgId),
    },
  ].slice(0, 4);
}

/** Classify Team Data Soft-UI shell — never invents DEMO team metrics. */
export function classifyTeamDataShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  hasActiveEvent?: boolean;
  tbaConfigured?: boolean;
  matchCount?: number;
  metricCount?: number;
  forbidden?: boolean;
}): TeamDataShellKind {
  if (input.loading) return "loading";
  if (!input.orgId) return "setup";
  if (input.fetchFailed || input.forbidden) return "error";
  if (input.hasActiveEvent === false || input.tbaConfigured === false) return "setup";
  if ((input.matchCount ?? 0) === 0 && (input.metricCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Count a labeled inventory/reference row without inventing DEMO values. */
export function referenceCount(
  rows: Array<{ label: string; count: number }> | null | undefined,
  label: string,
): number {
  const row = rows?.find((item) => item.label === label);
  const count = row?.count;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Whether TBA ingest can run: org credential present, or already has a
 * last-good cache, or platform health recorded a real (non-unknown) status.
 * Never treats missing config as "ready with DEMO data".
 */
export function isTbaConfigured(input: {
  credentialCount?: number;
  dataSourceMode?: string | null;
  cacheHasRows?: boolean;
  healthStatus?: string | null;
}): boolean {
  if ((input.credentialCount ?? 0) > 0) return true;
  if (input.cacheHasRows) return true;
  const status = (input.healthStatus ?? "").trim().toLowerCase();
  if (status && status !== "unknown" && status !== "unavailable") return true;
  if (input.dataSourceMode === "degraded" || input.dataSourceMode === "stale") return true;
  return false;
}
