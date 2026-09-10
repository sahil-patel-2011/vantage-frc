import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Match Video Index (never DEMO clip packs). */
export const MATCH_VIDEO_INDEX_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "match-notes-timeline", label: "Match Notes", tab: "match-notes-timeline" },
  { id: "match-delta-watcher", label: "Match-Delta", tab: "match-delta-watcher" },
  { id: "opponent-watchlist", label: "Watchlist", tab: "opponent-watchlist" },
] as const;

export type MatchVideoIndexRelatedId = (typeof MATCH_VIDEO_INDEX_RELATED_LINKS)[number]["id"];

export type MatchVideoIndexRelatedLink = {
  id: MatchVideoIndexRelatedId;
  label: string;
  href: string;
};

export const MATCH_VIDEO_INDEX_RELATED_INCLUDE: MatchVideoIndexRelatedId[] = [
  "scouting",
  "match-notes-timeline",
  "match-delta-watcher",
];

export function matchVideoIndexRelatedLinks(
  orgId?: string | null,
  options?: { active?: MatchVideoIndexRelatedId; include?: MatchVideoIndexRelatedId[] },
): MatchVideoIndexRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCH_VIDEO_INDEX_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type MatchVideoIndexShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchVideoIndexNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchVideoIndexEmptyCopy = {
  kind: MatchVideoIndexShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type MatchVideoIndexSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function matchVideoIndexSetupSteps(orgId?: string | null): MatchVideoIndexSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open video indexes.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Match keys from real scout entries pair cleanly with indexed clips.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "notes",
      label: "Open Match Notes",
      detail: "Timeline notes sit beside the same match keys as your videos.",
      href: hubHref("/competition", "match-notes-timeline", orgId),
    },
  ];
}

export function formatMatchVideoIndexMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowMatchVideoIndexSummaryTiles(videoCount: number, matchCount: number): boolean {
  return videoCount > 0 || matchCount > 0;
}

export function classifyMatchVideoIndexShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  videoCount?: number;
}): MatchVideoIndexShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.videoCount ?? 0) === 0) return "empty";
  return "ready";
}

export function matchVideoIndexShellCopy(kind: MatchVideoIndexShellKind): MatchVideoIndexEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Match Video Index…",
        description: "Checking workspace membership and indexed clips.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match Video Index",
        description:
          "A network or server issue blocked the index. Retry, or open Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pick a workspace before indexing clips.",
      };
    case "empty":
      return {
        kind,
        badge: "No videos yet",
        title: "Index your first match video",
        description: "Add a real video URL with its match key.",
      };
    default:
      return {
        kind: "ready",
        title: "Match video library",
        description: "Indexed from real URLs and match keys only.",
      };
  }
}

export function matchVideoIndexNextActions(input: {
  orgId?: string | null;
  shell: MatchVideoIndexShellKind;
  videoCount?: number;
}): MatchVideoIndexNextAction[] {
  const orgId = input.orgId ?? null;
  const videoCount = input.videoCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pick a team before adding clips.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Match keys stay blank until your team scouts.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Match Video Index can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Use real match keys when indexing clips.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match Video Index",
        detail: "Reload real indexed clips.",
        href: withOrgHref("/match-video-index", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while the index reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || videoCount === 0) {
    return [
      {
        id: "add-video",
        label: "Add a match video",
        detail: "Index stays blank until you paste a real URL and match key.",
        href: "#match-video-index-add",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Copy match keys from real scout entries.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "notes",
        label: "Open Match Notes",
        detail: "Pair timeline notes with the same match keys.",
        href: hubHref("/competition", "match-notes-timeline", orgId),
      },
    ];
  }

  return [
    {
      id: "review-clips",
      label: "Review indexed clips",
      detail: `${videoCount} video${videoCount === 1 ? "" : "s"} from real URLs.`,
      href: "#match-video-index-groups",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Cross-check clips against scout entries.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "delta",
      label: "Open Match-Delta",
      detail: "Flag upsets beside the same match keys.",
      href: hubHref("/competition", "match-delta-watcher", orgId),
    },
  ];
}
