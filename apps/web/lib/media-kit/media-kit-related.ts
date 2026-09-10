import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Media Kit (never DEMO asset counts). */
export const MEDIA_KIT_RELATED_LINKS = [
  { id: "media", label: "Media team", kind: "path" as const, path: "/media" },
  { id: "media-library", label: "Media library", kind: "path" as const, path: "/media-library" },
  { id: "sponsor-suite", label: "Sponsor Suite", kind: "business" as const, tab: "sponsor-suite" },
  { id: "outreach-calendar", label: "Outreach Calendar", kind: "business" as const, tab: "outreach-calendar" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "sponsors", label: "Sponsor CRM", kind: "business" as const, tab: "sponsors" },
] as const;

export type MediaKitRelatedId = (typeof MEDIA_KIT_RELATED_LINKS)[number]["id"];

export type MediaKitRelatedLink = {
  id: MediaKitRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Media team / Suite / Outreach / Impact. */
export const MEDIA_KIT_RELATED_INCLUDE: MediaKitRelatedId[] = [
  "media",
  "media-library",
  "sponsor-suite",
  "outreach-calendar",
  "impact",
];

/**
 * Soft-UI cross-links from Media Kit → Media / Suite / Outreach / Impact.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function mediaKitRelatedLinks(
  orgId?: string | null,
  options?: { active?: MediaKitRelatedId; include?: MediaKitRelatedId[] },
): MediaKitRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MEDIA_KIT_RELATED_LINKS.filter((link) => {
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

export type MediaKitShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MediaKitNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MediaKitEmptyCopy = {
  kind: MediaKitShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO media metrics. */
export type MediaKitSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function mediaKitSetupSteps(orgId?: string | null): MediaKitSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open media kits.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "profile",
      label: "Record team profile",
      detail: "Mission, bio, and contact stay blank until you enter them.",
      href: orgId ? withOrgHref("/media-kit", orgId) : "/media-kit",
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Pair media assets with real sponsor decks.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
    {
      id: "outreach-calendar",
      label: "Open Outreach Calendar",
      detail: "Outreach stays empty until you schedule real events.",
      href: hubHref("/business", "outreach-calendar", orgId),
    },
  ];
}

/** Real readiness / asset counts only — never invent DEMO totals. */
export function formatMediaKitMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when the kit is empty — avoids DEMO counters. */
export function shouldShowMediaKitSummaryTiles(input: {
  assetCount: number;
  documentCount: number;
  readinessScore: number;
}): boolean {
  return input.assetCount > 0 || input.documentCount > 0 || input.readinessScore > 0;
}

/** True when nothing has been recorded yet — Soft-UI empty. */
export function isMediaKitBoardEmpty(input: {
  assetCount: number;
  documentCount: number;
  readinessScore: number;
}): boolean {
  return input.assetCount === 0 && input.documentCount === 0 && input.readinessScore <= 0;
}

/** Classify Media Kit Soft-UI shell — never invents DEMO media metrics. */
export function classifyMediaKitShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  assetCount?: number;
  documentCount?: number;
  readinessScore?: number;
}): MediaKitShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (
    isMediaKitBoardEmpty({
      assetCount: input.assetCount ?? 0,
      documentCount: input.documentCount ?? 0,
      readinessScore: input.readinessScore ?? 0,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO media metrics. */
export function mediaKitShellCopy(kind: MediaKitShellKind): MediaKitEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Media Kit…",
        description:
          "Checking which team you are on and recorded assets.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Media Kit",
        description:
          "A network or server issue blocked the kit. Retry, or open Sponsor Suite / Outreach while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team and record real profile fields before generating one-pagers.",
      };
    case "empty":
      return {
        kind,
        badge: "No media yet",
        title: "Record your first media kit fields",
        description:
          "Mission, bio, logos, and one-pagers stay blank until you add them. Cross-check Sponsor Suite and Outreach.",
      };
    default:
      return {
        kind: "ready",
        title: "Sponsor- and media-ready kit",
        description:
          "Completeness reflects fields and assets you recorded.",
      };
  }
}

/**
 * Soft-UI next actions for Media Kit empty/setup shells.
 * Points at profile / Suite / Outreach — never invents DEMO media metrics.
 */
export function mediaKitNextActions(input: {
  orgId?: string | null;
  shell: MediaKitShellKind;
  assetCount?: number;
  documentCount?: number;
}): MediaKitNextAction[] {
  const orgId = input.orgId ?? null;
  const assetCount = input.assetCount ?? 0;
  const documentCount = input.documentCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of mediaKitSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(mediaKitSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Media Kit",
        detail: "Reload real profile and assets.",
        href: withOrgHref("/media-kit", orgId),
        primary: true,
      },
      {
        id: "sponsor-suite",
        label: "Open Sponsor Suite",
        detail: "Sponsor decks stay available while the kit reloads.",
        href: hubHref("/business", "sponsor-suite", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact evidence stays available while the kit reloads.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "profile",
        label: "Save team profile",
        detail: "Mission and bio stay blank until you enter them.",
        href: "#media-kit-profile",
        primary: true,
      },
      {
        id: "assets",
        label: "Add a logo or photo",
        detail: "Asset library stays empty until you add real URLs.",
        href: "#media-kit-assets",
      },
      {
        id: "sponsor-suite",
        label: "Open Sponsor Suite",
        detail: "Pair kit assets with real sponsor decks.",
        href: hubHref("/business", "sponsor-suite", orgId),
      },
    ];
  }

  const actions: MediaKitNextAction[] = [
    {
      id: "assets",
      label: assetCount > 0 ? "Add another asset" : "Add a logo or photo",
      detail:
        assetCount > 0
          ? `${assetCount} asset${assetCount === 1 ? "" : "s"} recorded — only real URLs.`
          : "Asset library stays empty until you add real URLs.",
      href: "#media-kit-assets",
      primary: true,
    },
    {
      id: "one-pager",
      label: documentCount > 0 ? "Generate another one-pager" : "Generate one-pager",
      detail:
        documentCount > 0
          ? `${documentCount} one-pager${documentCount === 1 ? "" : "s"} from recorded fields only.`
          : "One-pagers assemble only recorded profile fields.",
      href: "#media-kit-documents",
    },
    {
      id: "sponsor-suite",
      label: "Open Sponsor Suite",
      detail: "Pair kit assets with real sponsor decks.",
      href: hubHref("/business", "sponsor-suite", orgId),
    },
    {
      id: "outreach-calendar",
      label: "Open Outreach Calendar",
      detail: "Keep outreach projections grounded in scheduled events.",
      href: hubHref("/business", "outreach-calendar", orgId),
    },
  ];

  return actions.slice(0, 5);
}
