import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";

/** Soft-UI related surfaces for Video Re-Scout (never DEMO jobs). */
export const VIDEO_RESCOUT_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "disagreements", label: "Disagreements", kind: "path" as const, path: "/scout-disagreements" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
] as const;

export type VideoRescoutRelatedId = (typeof VIDEO_RESCOUT_RELATED_LINKS)[number]["id"];

export type VideoRescoutRelatedLink = {
  id: VideoRescoutRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Accuracy · Disagreements. */
export const VIDEO_RESCOUT_RELATED_INCLUDE: VideoRescoutRelatedId[] = [
  "scouting",
  "accuracy",
  "disagreements",
];

/**
 * Soft-UI cross-links from Video Re-Scout → Scouting / Accuracy / Disagreements.
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

export function videoRescoutSetupSteps(orgId?: string | null): VideoRescoutSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open video re-scout.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Confirm a match schema so timeline scores can commit.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "TBA-verified ranks help decide which re-scout values to trust.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
    {
      id: "disagreements",
      label: "Open Disagreements",
      detail: "Re-watch clips when stand scouts conflict.",
      href: withOrgHref("/scout-disagreements", orgId),
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pin the event so committed re-scout rows stay on the right matches.",
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
        title: "Loading video re-scout…",
        description:
          "Checking which team you are on and saved match reviews.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load video re-scout",
        description:
          "A network or server issue blocked match reviews. Retry, or open Scouting / Accuracy / Disagreements while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before match reviews appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No reviews yet",
        title: "Waiting on a real match clip",
        description:
          "Paste a YouTube match link and assign up to four teams to re-scout. Cross-check Scouting, Accuracy, and Disagreements.",
      };
    default:
      return {
        kind: "ready",
        title: "Video re-scout",
        description:
          "Pause, rewind, and stamp timeline scores from real match footage.",
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
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before saving reviews.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Match schemas stay blank until your team configures them.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "accuracy",
          label: "Open Accuracy",
          detail: "TBA-verified ranks stay honest until real scout rows exist.",
          href: withOrgHref("/scout-accuracy", null),
        },
        {
          id: "disagreements",
          label: "Open Disagreements",
          detail: "Conflict queues stay blank until overlapping fields exist.",
          href: withOrgHref("/scout-disagreements", null),
        },
      ];
    }
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Confirm a match schema so timeline scores can commit.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Use TBA-verified ranks when choosing which re-scout values to trust.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "disagreements",
        label: "Open Disagreements",
        detail: "Re-watch clips when stand scouts conflict on a field.",
        href: withOrgHref("/scout-disagreements", orgId),
      },
      {
        id: "command",
        label: "Set active event",
        detail: "Confirm the event so committed rows stay match-scoped.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry video re-scout",
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
        detail: "Cross-check TBA-verified ranks before re-scouting disputed totals.",
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
      detail: "Committed re-scout rows land beside membership-bound match entries.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Prefer TBA-accurate scouts when re-scouting disputed totals.",
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
