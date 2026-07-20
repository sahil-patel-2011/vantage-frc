import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Drive-Team Signals (never DEMO cheat sheets). */
export const DRIVE_TEAM_SIGNALS_RELATED_LINKS = [
  { id: "match-checklist", label: "Match Checklist", tab: "match-checklist" },
  { id: "match-strategy-cards", label: "Strategy Cards", tab: "match-strategy-cards" },
  { id: "match-copilot", label: "Match Copilot", tab: "match-copilot" },
  { id: "field-reset-timer", label: "Field Reset Timer", hub: "/team" as const, tab: "field-reset-timer" },
] as const;

export type DriveTeamSignalsRelatedId = (typeof DRIVE_TEAM_SIGNALS_RELATED_LINKS)[number]["id"];

export type DriveTeamSignalsRelatedLink = {
  id: DriveTeamSignalsRelatedId;
  label: string;
  href: string;
};

export const DRIVE_TEAM_SIGNALS_RELATED_INCLUDE: DriveTeamSignalsRelatedId[] = [
  "match-checklist",
  "match-strategy-cards",
  "match-copilot",
];

export function driveTeamSignalsRelatedLinks(
  orgId?: string | null,
  options?: { active?: DriveTeamSignalsRelatedId; include?: DriveTeamSignalsRelatedId[] },
): DriveTeamSignalsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DRIVE_TEAM_SIGNALS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("hub" in link ? link.hub : "/competition", link.tab, orgId),
  }));
}

export type DriveTeamSignalsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DriveTeamSignalsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DriveTeamSignalsEmptyCopy = {
  kind: DriveTeamSignalsShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type DriveTeamSignalsSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function driveTeamSignalsSetupSteps(orgId?: string | null): DriveTeamSignalsSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — signal sheets are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "checklist",
      label: "Open Match Checklist",
      detail: "Pair pre-match cues with the same drive-crew language.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "cards",
      label: "Open Strategy Cards",
      detail: "Match plans reference the same callouts as your signal board.",
      href: hubHref("/competition", "match-strategy-cards", orgId),
    },
  ];
}

export function formatDriveTeamSignalsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowDriveTeamSignalsSummaryTiles(sheetCount: number, signalCount: number): boolean {
  return sheetCount > 0 || signalCount > 0;
}

export function classifyDriveTeamSignalsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sheetCount?: number;
}): DriveTeamSignalsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.sheetCount ?? 0) === 0) return "empty";
  return "ready";
}

export function driveTeamSignalsShellCopy(kind: DriveTeamSignalsShellKind): DriveTeamSignalsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Drive-Team Signals…",
        description: "Checking workspace membership and signal sheets — never DEMO cheat sheets.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Drive-Team Signals",
        description:
          "A network or server issue blocked the signal board. Retry, or open Match Checklist while it reloads — never invent DEMO sheets.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Drive-Team Signals is org-scoped. Pick a workspace before defining real callouts — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No sheets yet",
        title: "Create your first signal sheet",
        description:
          "Hand signals, radio codes, and field markers your drive crew actually uses — never DEMO cheat sheets.",
      };
    default:
      return {
        kind: "ready",
        title: "Drive-team signal board",
        description: "Sheets and signals from your crew only — never DEMO counters.",
      };
  }
}

export function driveTeamSignalsNextActions(input: {
  orgId?: string | null;
  shell: DriveTeamSignalsShellKind;
  sheetCount?: number;
  signalCount?: number;
}): DriveTeamSignalsNextAction[] {
  const orgId = input.orgId ?? null;
  const sheetCount = input.sheetCount ?? 0;
  const signalCount = input.signalCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Signal sheets are org-scoped — pick a team before defining callouts.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "checklist",
          label: "Open Match Checklist",
          detail: "Pre-match cues stay blank until your team builds them.",
          href: hubHref("/competition", "match-checklist", null),
        },
        {
          id: "cards",
          label: "Open Strategy Cards",
          detail: "Strategy cards stay empty until match plans exist.",
          href: hubHref("/competition", "match-strategy-cards", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Drive-Team Signals can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "checklist",
        label: "Open Match Checklist",
        detail: "Pair pre-match cues with drive-crew language.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "cards",
        label: "Open Strategy Cards",
        detail: "Match plans reference the same callouts.",
        href: hubHref("/competition", "match-strategy-cards", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Drive-Team Signals",
        detail: "Reload real signal sheets — nothing is invented while this fails.",
        href: withOrgHref("/drive-team-signals", orgId),
        primary: true,
      },
      {
        id: "checklist",
        label: "Open Match Checklist",
        detail: "Checklists stay available while the board reloads.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "copilot",
        label: "Open Match Copilot",
        detail: "Copilot stays available while the board reloads.",
        href: hubHref("/competition", "match-copilot", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sheetCount === 0) {
    return [
      {
        id: "create-sheet",
        label: "Create a signal sheet",
        detail: "Sheets stay blank until you create one — never DEMO cheat sheets.",
        href: "#drive-team-signals-new",
        primary: true,
      },
      {
        id: "checklist",
        label: "Open Match Checklist",
        detail: "Prep pre-match cues beside future callouts.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "reset",
        label: "Open Field Reset Timer",
        detail: "Reset drills use the same drive-crew language.",
        href: hubHref("/team", "field-reset-timer", orgId),
      },
    ];
  }

  return [
    {
      id: signalCount > 0 ? "review-signals" : "add-signals",
      label: signalCount > 0 ? "Review signal sheets" : "Add signals to a sheet",
      detail:
        signalCount > 0
          ? `${sheetCount} sheet${sheetCount === 1 ? "" : "s"} · ${signalCount} signal${signalCount === 1 ? "" : "s"} from your crew — never DEMO sheets.`
          : `${sheetCount} sheet${sheetCount === 1 ? "" : "s"} ready — add codes your drive team actually uses.`,
      href: "#drive-team-signals-sheets",
      primary: true,
    },
    {
      id: "checklist",
      label: "Open Match Checklist",
      detail: "Cross-check pre-match cues with signal codes.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "cards",
      label: "Open Strategy Cards",
      detail: "Keep match plans aligned with drive-crew language.",
      href: hubHref("/competition", "match-strategy-cards", orgId),
    },
  ];
}
