import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";
import { isMediaWorkspaceEmpty } from ".";

/** Soft-UI related surfaces for Media workspace (never DEMO metrics). */
export const MEDIA_RELATED_LINKS = [
  { id: "media-kit", label: "Media Kit", kind: "path" as const, path: "/media-kit" },
  { id: "outreach-calendar", label: "Outreach Calendar", kind: "business" as const, tab: "outreach-calendar" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "sponsor-wall", label: "Sponsor Wall", kind: "business" as const, tab: "sponsor-wall" },
  { id: "recognition", label: "Recognition", kind: "path" as const, path: "/recognition" },
] as const;

export type MediaRelatedId = (typeof MEDIA_RELATED_LINKS)[number]["id"];

export type MediaRelatedLink = {
  id: MediaRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Kit / Outreach / Impact / Sponsor Wall. */
export const MEDIA_RELATED_INCLUDE: MediaRelatedId[] = [
  "media-kit",
  "outreach-calendar",
  "impact",
  "sponsor-wall",
];

/**
 * Soft-UI cross-links from Media workspace → Kit / Outreach / Impact / Wall.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function mediaRelatedLinks(
  orgId?: string | null,
  options?: { active?: MediaRelatedId; include?: MediaRelatedId[] },
): MediaRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MEDIA_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href:
      link.kind === "business"
        ? hubHref("/business", link.tab, orgId)
        : orgId
          ? withOrgHref(link.path, orgId)
          : link.path,
  }));
}

export type MediaShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MediaNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MediaEmptyCopy = {
  kind: MediaShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO media metrics. */
export type MediaSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function mediaSetupSteps(orgId?: string | null): MediaSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open media tools.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "media-kit",
      label: "Build Media Kit",
      detail: "Mission, bio, and logos stay blank until you record them.",
      href: orgId ? withOrgHref("/media-kit", orgId) : "/media-kit",
    },
    {
      id: "outreach-calendar",
      label: "Schedule outreach",
      detail: "Press and demo dates stay empty until you add real events — no sample reach.",
      href: hubHref("/business", "outreach-calendar", orgId),
    },
    {
      id: "impact",
      label: "Log media impact",
      detail: "Hours and people reached stay blank until you log real activities.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}

/** Classify Media Soft-UI shell — never invents DEMO media metrics. */
export function classifyMediaShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  assetCount?: number;
  documentCount?: number;
  readinessScore?: number;
  upcomingCount?: number;
  mediaCategoryCount?: number;
  mediaActivityCount?: number;
  publishedEntryCount?: number;
  itemCount?: number;
}): MediaShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (
    isMediaWorkspaceEmpty({
      kit: {
        assetCount: input.assetCount ?? 0,
        documentCount: input.documentCount ?? 0,
        readinessScore: input.readinessScore ?? 0,
      },
      outreach: {
        upcomingCount: input.upcomingCount ?? 0,
        mediaCategoryCount: input.mediaCategoryCount ?? 0,
      },
      impact: { mediaActivityCount: input.mediaActivityCount ?? 0 },
      sponsorWall: { publishedEntryCount: input.publishedEntryCount ?? 0 },
      items: Array.from({ length: input.itemCount ?? 0 }, (_, index) => ({ id: String(index) })),
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO media metrics. */
export function mediaShellCopy(kind: MediaShellKind): MediaEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Media workspace…",
        description:
          "Checking workspace membership and recorded press assets.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Media",
        description:
          "A network or server issue blocked the workspace. Retry, or open Media Kit / Outreach while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Media is your team's for business and press workflows. Pick a workspace before recording assets or outreach.",
      };
    case "empty":
      return {
        kind,
        badge: "No media yet",
        title: "Start your press and social toolkit",
        description:
          "Assets, outreach dates, and media impact stay blank until you add them. Open Media Kit or Outreach.",
      };
    default:
      return {
        kind: "ready",
        title: "Media workspace",
        description:
          "Counts reflect content items, Media Kit, outreach, impact, and sponsor visuals you recorded.",
      };
  }
}

/**
 * Soft-UI next actions for Media empty/setup shells.
 * Points at Kit / Outreach / Impact — never invents DEMO media metrics.
 */
export function mediaNextActions(input: {
  orgId?: string | null;
  shell: MediaShellKind;
  assetCount?: number;
  upcomingCount?: number;
}): MediaNextAction[] {
  const orgId = input.orgId ?? null;
  const assetCount = input.assetCount ?? 0;
  const upcomingCount = input.upcomingCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of mediaSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(mediaSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Media",
        detail: "Reload real kit and outreach counts.",
        href: withOrgHref("/media", orgId),
        primary: true,
      },
      {
        id: "media-kit",
        label: "Open Media Kit",
        detail: "Kit editor stays available while the workspace reloads.",
        href: withOrgHref("/media-kit", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact evidence stays available while the workspace reloads.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "media-kit",
        label: "Build Media Kit",
        detail: "Mission, bio, and logos stay blank until you enter them.",
        href: withOrgHref("/media-kit", orgId),
        primary: true,
      },
      {
        id: "outreach-calendar",
        label: "Schedule a media event",
        detail: "Press dates stay empty until you add them.",
        href: hubHref("/business", "outreach-calendar", orgId),
      },
      {
        id: "sponsor-wall",
        label: "Open Sponsor Wall",
        detail: "Sponsor visuals stay blank until real logos land.",
        href: hubHref("/business", "sponsor-wall", orgId),
      },
    ];
  }

  return [
    {
      id: "media-kit",
      label: assetCount > 0 ? "Manage assets" : "Add a logo or photo",
      detail:
        assetCount > 0
          ? `${assetCount} asset${assetCount === 1 ? "" : "s"} in the kit — only real URLs.`
          : "Asset library stays empty until you add real URLs.",
      href: withOrgHref("/media-kit", orgId),
      primary: true,
    },
    {
      id: "outreach-calendar",
      label: upcomingCount > 0 ? "Review outreach calendar" : "Schedule outreach",
      detail:
        upcomingCount > 0
          ? `${upcomingCount} upcoming event${upcomingCount === 1 ? "" : "s"} on the calendar.`
          : "Outreach stays empty until you schedule real events.",
      href: hubHref("/business", "outreach-calendar", orgId),
    },
    {
      id: "impact",
      label: "Log media impact",
      detail: "Hours and people reached come from logged activities only.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "sponsor-wall",
      label: "Curate Sponsor Wall",
      detail: "Published logos and messages stay blank until you add them.",
      href: hubHref("/business", "sponsor-wall", orgId),
    },
  ].slice(0, 5);
}
