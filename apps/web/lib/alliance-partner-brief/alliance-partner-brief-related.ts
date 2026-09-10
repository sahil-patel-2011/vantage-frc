import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Alliance-Partner Brief (never DEMO partner metrics). */
export const ALLIANCE_PARTNER_BRIEF_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "alliance-board", label: "Alliance board", kind: "path" as const, path: "/strategy/draft" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "chemistry", label: "Chemistry", kind: "hub" as const, tab: "chemistry" },
  { id: "picklist-collab", label: "Pick list", kind: "hub" as const, tab: "picklist-collab" },
] as const;

export type AlliancePartnerBriefRelatedId = (typeof ALLIANCE_PARTNER_BRIEF_RELATED_LINKS)[number]["id"];

export type AlliancePartnerBriefRelatedLink = {
  id: AlliancePartnerBriefRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Alliance board / Scouting first. */
export const ALLIANCE_PARTNER_BRIEF_RELATED_INCLUDE: AlliancePartnerBriefRelatedId[] = [
  "strategy",
  "alliance-board",
  "scouting",
];

/**
 * Soft-UI cross-links from Alliance-Partner Brief → Strategy / Alliance board / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function alliancePartnerBriefRelatedLinks(
  orgId?: string | null,
  options?: { active?: AlliancePartnerBriefRelatedId; include?: AlliancePartnerBriefRelatedId[] },
): AlliancePartnerBriefRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ALLIANCE_PARTNER_BRIEF_RELATED_LINKS.filter((link) => {
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

export type AlliancePartnerBriefShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type AlliancePartnerBriefNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AlliancePartnerBriefEmptyCopy = {
  kind: AlliancePartnerBriefShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real alliance / partner counts only — never invent DEMO partner totals. */
export function formatAlliancePartnerBriefMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no alliances are finalized — avoids DEMO counters. */
export function shouldShowAlliancePartnerBriefSummaryTiles(finalizedCount: number): boolean {
  return finalizedCount > 0;
}

/** Classify Alliance-Partner Brief Soft-UI shell — never invents DEMO partner metrics. */
export function classifyAlliancePartnerBriefShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  finalizedCount?: number;
}): AlliancePartnerBriefShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.finalizedCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO partner metrics. */
export function alliancePartnerBriefShellCopy(kind: AlliancePartnerBriefShellKind): AlliancePartnerBriefEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Alliance-Partner Brief…",
        description:
          "Checking workspace membership and alliance boards.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Alliance-Partner Brief",
        description:
          "A network or server issue blocked the brief. Retry, or open Strategy / Alliance board / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pick a workspace and run alliance selection before generating a partner brief.",
      };
    case "empty":
      return {
        kind,
        badge: "No alliances yet",
        title: "Finalize alliance picks first",
        description:
          "Partner briefs stay blank until captains and picks land on a real alliance board. Cross-check Strategy, Alliance board, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Alliance partner roles & strengths",
        description:
          "Briefs cite only event metrics and your own scouting for finalized partners.",
      };
  }
}

/**
 * Soft-UI next actions for Alliance-Partner Brief empty/setup shells.
 * Points at Strategy / Alliance board / Scouting — never invents DEMO partner metrics.
 */
export function alliancePartnerBriefNextActions(input: {
  orgId?: string | null;
  shell: AlliancePartnerBriefShellKind;
  finalizedCount?: number;
  partnerCount?: number;
  hasBrief?: boolean;
}): AlliancePartnerBriefNextAction[] {
  const orgId = input.orgId ?? null;
  const finalizedCount = input.finalizedCount ?? 0;
  const partnerCount = input.partnerCount ?? 0;
  const hasBrief = input.hasBrief ?? false;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pick a team before generating roles.",
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
          id: "alliance-board",
          label: "Open Alliance board",
          detail: "Alliance slots stay blank until your team runs selection.",
          href: withOrgHref("/strategy/draft", null),
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
        label: "Open Workspace",
        detail: "Finish membership setup so Alliance-Partner Brief can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "alliance-board",
        label: "Open Alliance board",
        detail: "Run and finalize alliance selection before generating a partner brief.",
        href: withOrgHref("/strategy/draft", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context and pick lists before briefing partners.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Ground partner strengths in real scout rows.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Alliance-Partner Brief",
        detail: "Reload real alliance and brief rows.",
        href: withOrgHref("/alliance-partner-brief", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the brief reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "alliance-board",
        label: "Open Alliance board",
        detail: "Alliance selection stays available while the brief reloads.",
        href: withOrgHref("/strategy/draft", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the brief reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || finalizedCount === 0) {
    return [
      {
        id: "alliance-board",
        label: "Finalize alliance picks",
        detail: "Captain and pick slots must land on a real board before a partner brief exists.",
        href: withOrgHref("/strategy/draft", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Pick lists use scouted and reference metrics only.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Field observations stay blank until real scout rows exist.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ].slice(0, 4);
  }

  const actions: AlliancePartnerBriefNextAction[] = [];

  if (hasBrief && partnerCount > 0) {
    actions.push({
      id: "review-partners",
      label: "Review partner brief",
      detail: `${partnerCount} partner${partnerCount === 1 ? "" : "s"} cited from event metrics and your scouting.`,
      href: "#alliance-partner-brief-panel",
      primary: true,
    });
  } else {
    actions.push({
      id: "generate-brief",
      label: "Generate partner brief",
      detail: `${finalizedCount} finalized alliance${finalizedCount === 1 ? "" : "s"} — generate roles only from real metrics and scout rows.`,
      href: "#alliance-partner-brief-panel",
      primary: true,
    });
  }

  actions.push(
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground alliance plans in scouted data and reference metrics.",
      href: hubHref("/competition", "strategy", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "alliance-board",
      label: "Open Alliance board",
      detail: "Confirm captains and picks before regenerating a brief.",
      href: withOrgHref("/strategy/draft", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Partner strengths stay blank until real scout rows exist.",
      href: hubHref("/competition", "scouting", orgId),
    },
  );

  return actions.slice(0, 5);
}
