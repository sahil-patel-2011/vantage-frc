import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Related surfaces for Video (never DEMO video counts). */
export const VIDEO_ANALYSIS_RELATED_LINKS = [
  { id: "command", label: "Event day", kind: "hub" as const, tab: "command" },
  { id: "match-notes", label: "Match notes", kind: "path" as const, path: "/match-notes-timeline" },
  { id: "match-video", label: "Match video", kind: "path" as const, path: "/video" },
  { id: "relays", label: "AI relays", kind: "path" as const, path: "/team/relays" },
] as const;

export type VideoAnalysisRelatedId = (typeof VIDEO_ANALYSIS_RELATED_LINKS)[number]["id"];

export type VideoAnalysisRelatedLink = {
  id: VideoAnalysisRelatedId;
  label: string;
  href: string;
};

/** Focused header strip — Event day · Match notes · Match video. */
export const VIDEO_ANALYSIS_RELATED_INCLUDE: VideoAnalysisRelatedId[] = [
  "command",
  "match-notes",
  "match-video",
];

/**
 * Cross-links from Video → Event day / Match notes / Match video.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function videoAnalysisRelatedLinks(
  orgId?: string | null,
  options?: { active?: VideoAnalysisRelatedId; include?: VideoAnalysisRelatedId[] },
): VideoAnalysisRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return VIDEO_ANALYSIS_RELATED_LINKS.filter((link) => {
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

export type VideoAnalysisShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type VideoAnalysisNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type VideoAnalysisEmptyCopy = {
  kind: VideoAnalysisShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type VideoAnalysisSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export const VIDEO_SOURCE_KINDS = ["youtube", "tba", "upload", "pit_stream"] as const;
export type VideoSourceKind = (typeof VIDEO_SOURCE_KINDS)[number];

export type VideoAnalysisEvent = {
  tSec?: number;
  kind?: string;
  teamKey?: string;
  label?: string;
  confidence?: number;
};

export type VideoAnalysisResult = {
  summary?: string;
  events?: VideoAnalysisEvent[];
};

export type VideoAnalysisJob = {
  id: string;
  sourceKind: string;
  sourceRef: string;
  matchKey: string | null;
  status: string;
  minutesBehind: number | null;
  error: string | null;
  createdAt: string;
  result: VideoAnalysisResult | null;
  confirmed: boolean;
};

export type VideoAnalysisSnapshot = { jobs: VideoAnalysisJob[] };

export const VIDEO_PAGE_DESCRIPTION =
  "Paste a match or pit video. Confirm keeps the timeline as video evidence — it does not overwrite what a scout typed.";

function videoAnalysisRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    videoAnalysisRelatedLinks(orgId, { include: [...VIDEO_ANALYSIS_RELATED_INCLUDE] }).map(
      (link) => link.href,
    ),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = videoAnalysisRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function videoAnalysisSetupSteps(orgId?: string | null): VideoAnalysisSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team so pasted videos belong to this team.",
        href: "/workspace",
      },
    ];
  }
  return [];
}

/** Real queued-video counts only. */
export function formatVideoAnalysisMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function isVideoAnalysisQueueEmpty(input: { jobCount: number }): boolean {
  return input.jobCount === 0;
}

export function pendingVideoConfirmCount(jobs: readonly VideoAnalysisJob[]): number {
  return jobs.filter((job) => job.status === "completed" && !job.confirmed).length;
}

/** Classify Video shell — empty until a real row exists. */
export function classifyVideoAnalysisShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  jobCount?: number;
}): VideoAnalysisShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  if (isVideoAnalysisQueueEmpty({ jobCount: input.jobCount ?? 0 })) return "empty";
  return "ready";
}

/** Empty / setup / error copy — no jobs jargon, no confidence numbers. */
export function videoAnalysisShellCopy(kind: VideoAnalysisShellKind): VideoAnalysisEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Video…",
        description: "Checking which team you are on and videos already queued.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Video",
        description: "A network or server issue blocked Video. Retry, or open Match notes while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before pasting a match or pit video.",
      };
    case "empty":
      return {
        kind,
        badge: "No videos yet",
        title: "Paste a match or pit video",
        description:
          "Paste a YouTube, Blue Alliance, file, or pit camera link. The timeline stays blank until this video is watched.",
      };
    case "ready":
      return {
        kind,
        title: "Video",
        description: VIDEO_PAGE_DESCRIPTION,
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function labelVideoSourceKind(kind: string): string {
  switch (kind) {
    case "youtube":
      return "YouTube";
    case "tba":
      return "The Blue Alliance";
    case "upload":
      return "File";
    case "pit_stream":
    case "pit_camera":
      return "Pit camera";
    default:
      return "Video";
  }
}

export function labelVideoStatus(status: string, confirmed: boolean): string {
  switch (status) {
    case "queued":
      return "Waiting";
    case "running":
      return "Watching";
    case "completed":
      return confirmed ? "Saved as evidence" : "Ready to confirm";
    case "failed":
      return "Could not read this video";
    case "cancelled":
      return "Stopped";
    case "skipped":
      return "Skipped — this computer cannot watch video";
    default:
      return "In progress";
  }
}

/**
 * Student-facing sure-ness. Never print a raw 0–1 score.
 * Missing numbers stay "from video".
 */
export function videoEventSureLabel(confidence: number | null | undefined): string {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return "from video";
  if (confidence >= 0.8) return "from video · looks clear";
  if (confidence >= 0.5) return "from video · looks likely";
  return "from video · unsure";
}

/**
 * Next actions for Video. Empty/setup keep one EmptyState primary;
 * the panel paints only on ready and never repeats the header strip.
 */
export function videoAnalysisNextActions(input: {
  orgId?: string | null;
  shell: VideoAnalysisShellKind;
  jobCount?: number;
  pendingConfirmCount?: number;
}): VideoAnalysisNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(videoAnalysisSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "ready": {
      const pending = input.pendingConfirmCount ?? 0;
      return dropRelatedStripDuplicates(orgId, [
        {
          id: pending > 0 ? "confirm" : "timeline",
          label:
            pending > 0
              ? `Confirm ${pending} video${pending === 1 ? "" : "s"}`
              : "Watch the timeline",
          detail:
            pending > 0
              ? "Confirming keeps the timeline as video evidence. Scouted numbers stay as the scouts typed them."
              : "Events stay on this page until you confirm them. Scouted numbers do not change.",
          href: pending > 0 ? "#video-ready" : "#video-queue",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scouted cycle counts stay as the scouts entered them.",
          href: hubHref("/competition", "scouting", orgId),
        },
      ]);
    }
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}
