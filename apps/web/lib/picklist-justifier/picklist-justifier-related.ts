import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pick-list Auto-Justifier (never DEMO pick rationales). */
export const PICKLIST_JUSTIFIER_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, hub: "/competition" as const, tab: "strategy" },
  { id: "picklist-collab", label: "Collaborative Pick List", kind: "hub" as const, hub: "/competition" as const, tab: "picklist-collab" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, hub: "/competition" as const, tab: "scouting" },
  { id: "chemistry", label: "Chemistry", kind: "hub" as const, hub: "/competition" as const, tab: "chemistry" },
  { id: "draft", label: "Alliance board", kind: "path" as const, path: "/strategy/draft" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
] as const;

export type PicklistJustifierRelatedId = (typeof PICKLIST_JUSTIFIER_RELATED_LINKS)[number]["id"];

export type PicklistJustifierRelatedLink = {
  id: PicklistJustifierRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Collaborative Pick List / Scouting first. */
export const PICKLIST_JUSTIFIER_RELATED_INCLUDE: PicklistJustifierRelatedId[] = [
  "strategy",
  "picklist-collab",
  "scouting",
];

/**
 * Soft-UI cross-links from Pick-list Justifier → Strategy / Pick list / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function picklistJustifierRelatedLinks(
  orgId?: string | null,
  options?: { active?: PicklistJustifierRelatedId; include?: PicklistJustifierRelatedId[] },
): PicklistJustifierRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PICKLIST_JUSTIFIER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: link.kind === "hub" ? hubHref(link.hub, link.tab, orgId) : withOrgHref(link.path, orgId),
  }));
}

export type PicklistJustifierShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PicklistJustifierNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PicklistJustifierEmptyCopy = {
  kind: PicklistJustifierShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real pick-list / slot / contradiction counts only — never invent DEMO totals. */
export function formatPicklistJustifierMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no pick lists exist — avoids DEMO counters. */
export function shouldShowPicklistJustifierSummaryTiles(pickListCount: number): boolean {
  return pickListCount > 0;
}

/** Classify Pick-list Justifier Soft-UI shell — never invents DEMO rationales. */
export function classifyPicklistJustifierShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  pickListCount?: number;
}): PicklistJustifierShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.pickListCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO pick rationales. */
export function picklistJustifierShellCopy(kind: PicklistJustifierShellKind): PicklistJustifierEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Pick-list Justifier…",
        description:
          "Checking which team you are on and pick lists.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Pick-list Justifier",
        description:
          "A network or server issue blocked the pick list. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before justifying slots.",
      };
    case "empty":
      return {
        kind,
        badge: "No pick lists yet",
        title: "Build a pick list first",
        description:
          "Justifications stay blank until you have a real ranked pick list. Cross-check Strategy and Collaborative Pick List.",
      };
    default:
      return {
        kind: "ready",
        title: "Source-cited pick rationales",
        description:
          "Slots cite TBA hard metrics and your scout rows only.",
      };
  }
}

/**
 * Soft-UI next actions for Pick-list Justifier empty/setup shells.
 * Points at Strategy / Collaborative Pick List / Scouting — never invents DEMO rationales.
 */
export function picklistJustifierNextActions(input: {
  orgId?: string | null;
  shell: PicklistJustifierShellKind;
  pickListCount?: number;
  slotCount?: number;
  contradictionCount?: number;
}): PicklistJustifierNextAction[] {
  const orgId = input.orgId ?? null;
  const pickListCount = input.pickListCount ?? 0;
  const slotCount = input.slotCount ?? 0;
  const contradictionCount = input.contradictionCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before generating rationales.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Pick-list Justifier can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Create or open a pick list before generating rationales.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "picklist-collab",
        label: "Open Collaborative Pick List",
        detail: "Rank teams together before auto-justifying slots.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Pick-list Justifier",
        detail: "Reload real pick-list slots.",
        href: withOrgHref("/picklist-justifier", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while justifications reload.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while justifications reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || pickListCount === 0) {
    return [
      {
        id: "strategy",
        label: "Build a pick list",
        detail: "Rank real teams under Strategy — justifications stay blank until slots exist.",
        href: hubHref("/competition", "strategy", orgId),
        primary: true,
      },
      {
        id: "picklist-collab",
        label: "Open Collaborative Pick List",
        detail: "Co-edit ranks before generating source-cited rationales.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout observations strengthen rationales.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ].slice(0, 4);
  }

  const actions: PicklistJustifierNextAction[] = [];

  if (slotCount === 0) {
    actions.push({
      id: "add-slots",
      label: "Add ranked teams",
      detail: "This pick list has no slots yet — add teams under Strategy before generating.",
      href: hubHref("/competition", "strategy", orgId),
      primary: true,
    });
  } else if (contradictionCount > 0) {
    actions.push({
      id: "review-contradictions",
      label: "Review contradictions",
      detail: `${contradictionCount} slot${contradictionCount === 1 ? "" : "s"} where scouting disagrees with TBA.`,
      href: "#picklist-justifier-entries",
      primary: true,
    });
  } else {
    actions.push({
      id: "generate",
      label: "Generate justifications",
      detail: `${slotCount} slot${slotCount === 1 ? "" : "s"} ready — rationales cite TBA + your scout rows only.`,
      href: "#picklist-justifier-summary",
      primary: true,
    });
  }

  actions.push(
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Adjust ranks before regenerating rationales.",
      href: hubHref("/competition", "strategy", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add match observations that feed source citations.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "pick-clock",
      label: "Open Pick clock",
      detail: "Stored rationales appear as recommendation reasons.",
      href: withOrgHref("/pick-clock", orgId),
    },
    {
      id: "draft",
      label: "Open Alliance board",
      detail: "Carry justified picks onto the draft board.",
      href: withOrgHref("/strategy/draft", orgId),
    },
  );

  return actions.slice(0, 5);
}
