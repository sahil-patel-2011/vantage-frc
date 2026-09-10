import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team Retrospective (never DEMO retro metrics). */
export const RETRO_RELATED_LINKS = [
  { id: "messages", label: "Team chat", kind: "team" as const, tab: "messages" },
  { id: "fmea", label: "FMEA", kind: "team" as const, tab: "fmea" },
  { id: "decisions", label: "Decisions", kind: "path" as const, path: "/decisions" },
  { id: "season-report", label: "Season report", kind: "path" as const, path: "/season-report" },
  { id: "playbook", label: "Playbook", kind: "team" as const, tab: "knowledge" },
  { id: "team", label: "Team hub", kind: "team" as const, tab: "retro" },
] as const;

export type RetroRelatedId = (typeof RETRO_RELATED_LINKS)[number]["id"];

export type RetroRelatedLink = {
  id: RetroRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Messages · FMEA · Decisions. */
export const RETRO_RELATED_INCLUDE: RetroRelatedId[] = ["messages", "fmea", "decisions"];

/** Season report + playbook — the only honest destinations for real retro lessons. */
export const RETRO_HANDOFF_INCLUDE: RetroRelatedId[] = ["season-report", "playbook"];

/**
 * Soft-UI cross-links from Retro → Messages / FMEA / Decisions.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function retroRelatedLinks(
  orgId?: string | null,
  options?: { active?: RetroRelatedId; include?: RetroRelatedId[] },
): RetroRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return RETRO_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type RetroShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type RetroNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RetroEmptyCopy = {
  kind: RetroShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO retro metrics. */
export type RetroSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function retroSetupSteps(orgId?: string | null): RetroSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open retros and postmortems.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "messages",
      label: "Open Messages",
      detail: "Team chat stays blank until real threads exist.",
      href: hubHref("/team", "messages", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Season postmortems pull real FMEA rows only.",
      href: hubHref("/team", "fmea", orgId),
    },
    {
      id: "decisions",
      label: "Open Decisions",
      detail: "Postmortems cite logged decisions only.",
      href: withOrgHref("/decisions", orgId),
    },
  ];
}

/** Real session / item counts only — never invent DEMO totals. */
export function formatRetroMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no session activity exists — avoids DEMO counters. */
export function shouldShowRetroSummaryTiles(input: {
  sessionCount: number;
  itemCount: number;
  openActionCount: number;
}): boolean {
  return input.sessionCount > 0 && (input.itemCount > 0 || input.openActionCount > 0);
}

/** True when the team has no retro sessions yet — Soft-UI empty. */
export function isRetroBoardEmpty(input: { sessionCount: number }): boolean {
  return input.sessionCount === 0;
}

/** Classify Retro Soft-UI shell — never invents DEMO retro metrics. */
export function classifyRetroShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sessionCount?: number;
}): RetroShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isRetroBoardEmpty({ sessionCount: input.sessionCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO retro metrics. */
export function retroShellCopy(kind: RetroShellKind): RetroEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Team Retrospective…",
        description:
          "Checking which team you are on and real retro sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Team Retrospective",
        description:
          "A network or server issue blocked retros. Retry, or open Messages / FMEA / Decisions while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Join or pick a team before collecting start/stop/continue feedback.",
      };
    case "empty":
      return {
        kind,
        badge: "No session yet",
        title: "Start your first retro",
        description:
          "Start/stop/continue boards stay blank until you create a real session. Cross-check Messages, FMEA, and Decisions.",
      };
    default:
      return {
        kind: "ready",
        title: "Retro sessions",
        description:
          "Sessions, votes, and action items your team logged appear here.",
      };
  }
}

/**
 * Soft-UI next actions for Retro empty/setup shells.
 * Points at Messages / FMEA / Decisions — never invents DEMO retro metrics.
 */
export function retroNextActions(input: {
  orgId?: string | null;
  shell: RetroShellKind;
  sessionCount?: number;
  openActionCount?: number;
  learnedItemCount?: number;
}): RetroNextAction[] {
  const orgId = input.orgId ?? null;
  const sessionCount = input.sessionCount ?? 0;
  const openActionCount = input.openActionCount ?? 0;
  const learnedItemCount = input.learnedItemCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of retroSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(retroSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Retrospective",
        detail: "Reload real sessions and action items.",
        href: withOrgHref("/retro", orgId),
        primary: true,
      },
      {
        id: "messages",
        label: "Open Messages",
        detail: "Team chat stays available while Retro reloads.",
        href: hubHref("/team", "messages", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Failure rows stay honest when this surface is down.",
        href: hubHref("/team", "fmea", orgId),
      },
      {
        id: "decisions",
        label: "Open Decisions",
        detail: "Decision log stays independent of retro sessions.",
        href: withOrgHref("/decisions", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sessionCount === 0) {
    return [
      {
        id: "session",
        label: "Start a retro session",
        detail: "Create a session below to collect start/stop/continue feedback.",
        href: "#retro-new-session",
        primary: true,
      },
      {
        id: "messages",
        label: "Open Messages",
        detail: "Capture informal notes in team chat while the board is empty.",
        href: hubHref("/team", "messages", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Failure analysis stays separate until a postmortem is compiled.",
        href: hubHref("/team", "fmea", orgId),
      },
      {
        id: "decisions",
        label: "Open Decisions",
        detail: "Decision log feeds season postmortems.",
        href: withOrgHref("/decisions", orgId),
      },
    ];
  }

  return [
    {
      id: "actions",
      label: openActionCount > 0 ? "Review open action items" : "Retro board ready",
      detail:
        openActionCount > 0
          ? `${openActionCount} open action item${openActionCount === 1 ? "" : "s"} — tracked from real retro rows only.`
          : "Sessions, votes, and actions use logged rows only.",
      href: "#retro-actions",
      primary: true,
    },
    {
      id: "messages",
      label: "Open Messages",
      detail: "Share retro outcomes with the team channel.",
      href: hubHref("/team", "messages", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Cross-check failure modes before compiling a postmortem.",
      href: hubHref("/team", "fmea", orgId),
    },
    {
      id: "decisions",
      label: "Open Decisions",
      detail: "Confirm accepted/rejected decisions feeding this season's postmortem.",
      href: withOrgHref("/decisions", orgId),
    },
    {
      id: "handoff",
      label: learnedItemCount > 0 ? "Hand off lessons" : "Collect lessons first",
      detail:
        learnedItemCount > 0
          ? `${learnedItemCount} learned item${learnedItemCount === 1 ? "" : "s"} from real retro rows — send to Season report or Playbook. Nothing is invented.`
          : "Write start/stop/continue items before handing off.",
      href: "#retro-learned",
    },
    {
      id: "season-report",
      label: "Open Season report",
      detail: "Lessons appear there only after a real retro handoff.",
      href: withOrgHref("/season-report", orgId),
    },
    {
      id: "playbook",
      label: "Open Playbook",
      detail: "The wiki stays empty of retro lessons until you hand them off.",
      href: hubHref("/team", "knowledge", orgId),
    },
  ];
}
