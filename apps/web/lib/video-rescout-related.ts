import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";
import { setupActionsFrom } from "./setup-actions";

/** Soft-UI related surfaces for Video Re-Scout (never DEMO jobs). */
export const VIDEO_RESCOUT_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "disagreements", label: "Disagreements", kind: "path" as const, path: "/scout-disagreements" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "command", label: "Event day", kind: "hub" as const, tab: "command" },
] as const;

export type VideoRescoutRelatedId = (typeof VIDEO_RESCOUT_RELATED_LINKS)[number]["id"];

export type VideoRescoutRelatedLink = {
  id: VideoRescoutRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Event day. */
export const VIDEO_RESCOUT_RELATED_INCLUDE: VideoRescoutRelatedId[] = [
  "scouting",
  "command",
];

/**
 * Soft-UI cross-links from Video Re-Scout → Scouting / Event day.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function videoRescoutRelatedLinks(
  orgId?: string | null,
  options?: { active?: VideoRescoutRelatedId; include?: VideoRescoutRelatedId[] },
): VideoRescoutRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return VIDEO_RESCOUT_RELATED_LINKS.filter((link) => {
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

export type VideoRescoutShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type VideoRescoutNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type VideoRescoutEmptyCopy = {
  kind: VideoRescoutShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO jobs. */
export type VideoRescoutSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function videoRescoutRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    videoRescoutRelatedLinks(orgId, { include: [...VIDEO_RESCOUT_RELATED_INCLUDE] }).map(
      (link) => link.href,
    ),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = videoRescoutRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function videoRescoutSetupSteps(orgId?: string | null): VideoRescoutSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open match video.",
        href: "/workspace",
      },
    ];
  }
  return [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event these clips belong to — reviews stay blank until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatVideoRescoutMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when nothing is reviewed — avoids DEMO jobs. */
export function shouldShowVideoRescoutSummaryTiles(input: {
  reviewCount: number;
  scoreCount: number;
}): boolean {
  return input.reviewCount > 0 || input.scoreCount > 0;
}

/** True when the org has no saved video reviews — Soft-UI empty. */
export function isVideoRescoutQueueEmpty(input: { reviewCount: number }): boolean {
  return input.reviewCount === 0;
}

/** Classify Video Re-Scout Soft-UI shell — never invents DEMO jobs. */
export function classifyVideoRescoutShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  orgId?: string | null;
  reviewCount?: number;
}): VideoRescoutShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isVideoRescoutQueueEmpty({ reviewCount: input.reviewCount ?? 0 })) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO jobs. */
export function videoRescoutShellCopy(kind: VideoRescoutShellKind): VideoRescoutEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading match video…",
        description: "Checking which team you are on and saved match reviews.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load match video",
        description: "Could not load match video. Retry, or open Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before match reviews appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No reviews yet",
        title: "Waiting on a real match clip",
        description: "Paste a YouTube match link. Scores stay on the timeline until you commit them to Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Match video",
        description: "Pause, rewind, and stamp what happened from real match footage.",
      };
  }
}

/**
 * Soft-UI next actions for Video Re-Scout empty/setup shells.
 * Points at Scouting / Accuracy / Disagreements — never invents DEMO jobs.
 */
export function videoRescoutNextActions(input: {
  orgId?: string | null;
  shell: VideoRescoutShellKind;
  reviewCount?: number;
  scoreCount?: number;
}): VideoRescoutNextAction[] {
  const orgId = input.orgId ?? null;
  const reviewCount = input.reviewCount ?? 0;
  const scoreCount = input.scoreCount ?? 0;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(videoRescoutSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry match video",
        detail: "Reload real match reviews.",
        href: withOrgHref("/video", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while reviews reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Accuracy ranks stay available while reviews reload.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "disagreements",
        label: "Open Disagreements",
        detail: "Conflict queues stay available while reviews reload.",
        href: withOrgHref("/scout-disagreements", orgId),
      },
    ];
  }

  if (input.shell === "empty" || reviewCount === 0) {
    return [
      {
        id: "create",
        label: "Add a match review",
        detail: "Paste a YouTube link on this page — reviews stay blank until then.",
        href: "#video-new-review",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Confirm the match schema before you commit timeline scores.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Cross-check scout ranks before re-scouting disputed totals.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "disagreements",
        label: "Open Disagreements",
        detail: "Pick a conflicting field, then re-watch the clip here.",
        href: withOrgHref("/scout-disagreements", orgId),
      },
    ];
  }

  return [
    {
      id: "reviews",
      label:
        scoreCount > 0
          ? `Review ${scoreCount} timeline score${scoreCount === 1 ? "" : "s"}`
          : `Open ${reviewCount} review${reviewCount === 1 ? "" : "s"}`,
      detail:
        scoreCount > 0
          ? "Commit real timeline scores into scouting."
          : "Assign teams and stamp scores from the playhead.",
      href: scoreCount > 0 ? "#video-timeline" : "#video-reviews",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Committed re-scout rows land beside this team's match entries.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Prefer accurate scouts when re-scouting disputed totals.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
    {
      id: "disagreements",
      label: "Open Disagreements",
      detail: "Jump back to conflicting fields after you commit a re-scout.",
      href: withOrgHref("/scout-disagreements", orgId),
    },
  ];
}
