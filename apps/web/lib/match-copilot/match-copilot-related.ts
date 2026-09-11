import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Match Copilot (never DEMO match metrics). */
export const MATCH_COPILOT_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, hub: "/competition" as const, tab: "strategy" },
  { id: "command", label: "Command", kind: "hub" as const, hub: "/competition" as const, tab: "command" },
  { id: "fmea", label: "FMEA", kind: "hub" as const, hub: "/team" as const, tab: "fmea" },
  { id: "batteries", label: "Batteries", kind: "hub" as const, hub: "/team" as const, tab: "batteries" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, hub: "/competition" as const, tab: "scouting" },
] as const;

export type MatchCopilotRelatedId = (typeof MATCH_COPILOT_RELATED_LINKS)[number]["id"];

export type MatchCopilotRelatedLink = {
  id: MatchCopilotRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Command / FMEA first. */
export const MATCH_COPILOT_RELATED_INCLUDE: MatchCopilotRelatedId[] = ["strategy", "command", "fmea"];

/**
 * Soft-UI cross-links from Match Copilot → Strategy / Command / FMEA.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function matchCopilotRelatedLinks(
  orgId?: string | null,
  options?: { active?: MatchCopilotRelatedId; include?: MatchCopilotRelatedId[] },
): MatchCopilotRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCH_COPILOT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref(link.hub, link.tab, orgId),
  }));
}

export type MatchCopilotShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchCopilotNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchCopilotEmptyCopy = {
  kind: MatchCopilotShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real callout / opponent / risk / battery counts only — never invent DEMO totals. */
export function formatMatchCopilotMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when there is nothing to brief — avoids DEMO counters. */
export function shouldShowMatchCopilotSummaryTiles(calloutCount: number): boolean {
  return calloutCount > 0;
}

/** Classify Match Copilot Soft-UI shell — never invents DEMO match metrics. */
export function classifyMatchCopilotShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  calloutCount?: number;
}): MatchCopilotShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.calloutCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO match metrics. */
export function matchCopilotShellCopy(kind: MatchCopilotShellKind): MatchCopilotEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Match Copilot…",
        description:
          "Checking which team you are on and your next match.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match Copilot",
        description:
          "A network or server issue blocked the brief. Retry, or open Strategy / Command / FMEA while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team, set an active event, and confirm your next match before a brief appears.",
      };
    case "empty":
      return {
        kind,
        badge: "No callouts yet",
        title: "Generate this match's brief",
        description:
          "Callouts stay blank until opponent EPA, your strategy plan, open FMEA risks, or battery health land on real rows. Cross-check Strategy, Command, and FMEA.",
      };
    default:
      return {
        kind: "ready",
        title: "Next-match do-this brief",
        description:
          "Callouts fuse only real opponent EPA, stored strategy, open FMEA risks, and battery health.",
      };
  }
}

/**
 * Soft-UI next actions for Match Copilot empty/setup shells.
 * Points at Strategy / Command / FMEA — never invents DEMO match metrics.
 */
export function matchCopilotNextActions(input: {
  orgId?: string | null;
  shell: MatchCopilotShellKind;
  calloutCount?: number;
  hasAiBrief?: boolean;
}): MatchCopilotNextAction[] {
  const orgId = input.orgId ?? null;
  const calloutCount = input.calloutCount ?? 0;
  const hasAiBrief = input.hasAiBrief ?? false;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before fusing the next match.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Match plans stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "command",
          label: "Open Command",
          detail: "Active event stays blank until your team selects one.",
          href: hubHref("/competition", "command", null),
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Risk rows stay blank until your team logs them.",
          href: hubHref("/team", "fmea", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Match Copilot can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Set the active event so your next match can resolve.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context and match plans before generating callouts.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Ground risk callouts in real open failures.",
        href: hubHref("/team", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match Copilot",
        detail: "Reload real match and brief rows.",
        href: withOrgHref("/match-copilot", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the brief reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Event day command stays available while the brief reloads.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Open risks stay available while the brief reloads.",
        href: hubHref("/team", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || calloutCount === 0) {
    return [
      {
        id: "generate",
        label: "Generate match brief",
        detail: "Fuse opponent EPA, strategy, FMEA, and batteries into real callouts.",
        href: "#match-copilot-callouts",
        primary: true,
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Stored plans use scouted and reference metrics only.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Confirm the active event and schedule before queuing.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Risk callouts stay blank until real open failures exist.",
        href: hubHref("/team", "fmea", orgId),
      },
    ].slice(0, 4);
  }

  const actions: MatchCopilotNextAction[] = [];

  if (hasAiBrief && calloutCount > 0) {
    actions.push({
      id: "review-callouts",
      label: "Review match callouts",
      detail: `${calloutCount} callout${calloutCount === 1 ? "" : "s"} from real EPA, strategy, FMEA, and batteries.`,
      href: "#match-copilot-callouts",
      primary: true,
    });
  } else {
    actions.push({
      id: "generate-brief",
      label: "Generate match brief",
      detail: "Persist a metered brief from real opponent EPA, strategy, FMEA, and battery rows.",
      href: "#match-copilot-callouts",
      primary: true,
    });
  }

  actions.push(
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground match plans in scouted data and reference metrics.",
      href: hubHref("/competition", "strategy", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Confirm event day context before queuing.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Risk callouts stay blank until real open failures exist.",
      href: hubHref("/team", "fmea", orgId),
    },
  );

  return actions.slice(0, 5);
}
