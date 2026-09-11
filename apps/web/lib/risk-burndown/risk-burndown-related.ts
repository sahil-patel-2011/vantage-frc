import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Risk-Register Burndown (never DEMO risk metrics). */
export const RISK_BURNDOWN_RELATED_LINKS = [
  { id: "risks", label: "Risks", kind: "path" as const, path: "/risks" },
  { id: "fmea", label: "FMEA", kind: "team" as const, tab: "fmea" },
  { id: "knowledge", label: "Knowledge", kind: "team" as const, tab: "knowledge" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
] as const;

export type RiskBurndownRelatedId = (typeof RISK_BURNDOWN_RELATED_LINKS)[number]["id"];

export type RiskBurndownRelatedLink = {
  id: RiskBurndownRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Risks / FMEA first. */
export const RISK_BURNDOWN_RELATED_INCLUDE: RiskBurndownRelatedId[] = ["risks", "fmea"];

/**
 * Soft-UI cross-links from Risk-Register Burndown → Risks / FMEA.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function riskBurndownRelatedLinks(
  orgId?: string | null,
  options?: { active?: RiskBurndownRelatedId; include?: RiskBurndownRelatedId[] },
): RiskBurndownRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return RISK_BURNDOWN_RELATED_LINKS.filter((link) => {
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

export type RiskBurndownShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type RiskBurndownNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RiskBurndownEmptyCopy = {
  kind: RiskBurndownShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real risk counts only — never invent DEMO burndown totals. */
export function formatRiskBurndownMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no risks exist — avoids DEMO counters. */
export function shouldShowRiskBurndownSummaryTiles(riskCount: number): boolean {
  return riskCount > 0;
}

/** Classify Risk Burndown Soft-UI shell — never invents DEMO risk metrics. */
export function classifyRiskBurndownShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  riskCount?: number;
}): RiskBurndownShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.riskCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO risk metrics. */
export function riskBurndownShellCopy(kind: RiskBurndownShellKind): RiskBurndownEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Risk-Register Burndown…",
        description:
          "Checking which team you are on and real risk rows.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Risk-Register Burndown",
        description:
          "A network or server issue blocked the register. Retry, or open Risks / FMEA while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before logging real season risks.",
      };
    case "empty":
      return {
        kind,
        badge: "No risks yet",
        title: "Log a season risk before tracking burndown",
        description:
          "Open / closed counts stay blank until you log a real risk. Cross-check Risks and FMEA.",
      };
    default:
      return {
        kind: "ready",
        title: "Season risk-register burndown",
        description:
          "Open counts and severity bands use only logged risks.",
      };
  }
}

/**
 * Soft-UI next actions for Risk Burndown empty/setup shells.
 * Points at Risks / FMEA — never invents DEMO risk metrics.
 */
export function riskBurndownNextActions(input: {
  orgId?: string | null;
  shell: RiskBurndownShellKind;
  riskCount?: number;
  openRiskCount?: number;
  highSeverityOpenCount?: number;
}): RiskBurndownNextAction[] {
  const orgId = input.orgId ?? null;
  const riskCount = input.riskCount ?? 0;
  const openRiskCount = input.openRiskCount ?? 0;
  const highSeverityOpenCount = input.highSeverityOpenCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging season risks.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "risks",
          label: "Open Risks",
          detail: "Season L×I scores stay empty until you log them.",
          href: withOrgHref("/risks", null),
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Failure modes stay blank until logged.",
          href: hubHref("/team", "fmea", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Risk Burndown can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "risks",
        label: "Open Risks",
        detail: "Keep the season risk register aligned with what you burn down here.",
        href: withOrgHref("/risks", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Logged failure modes often seed the next open risk to mitigate.",
        href: hubHref("/team", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Risk Burndown",
        detail: "Reload real risks and burndown series.",
        href: withOrgHref("/risk-burndown", orgId),
        primary: true,
      },
      {
        id: "risks",
        label: "Open Risks",
        detail: "The season risk register stays available while burndown reloads.",
        href: withOrgHref("/risks", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Failure-mode work stays available while burndown reloads.",
        href: hubHref("/team", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || riskCount === 0) {
    return [
      {
        id: "log-risk",
        label: "Log a season risk",
        detail: "Title, L×I, and identified-on stay blank until you enter a real risk.",
        href: "#risk-burndown-log-risk",
        primary: true,
      },
      {
        id: "risks",
        label: "Open Risks",
        detail: "Season L×I scores stay empty until logged.",
        href: withOrgHref("/risks", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Pull failure modes that should become tracked season risks.",
        href: hubHref("/team", "fmea", orgId),
      },
    ].slice(0, 4);
  }

  const actions: RiskBurndownNextAction[] = [];

  if (highSeverityOpenCount > 0) {
    actions.push({
      id: "high-severity",
      label: "Review high-severity open risks",
      detail: `${highSeverityOpenCount} high-severity open risk${highSeverityOpenCount === 1 ? "" : "s"} — mitigate or accept real rows only.`,
      href: "#risk-burndown-register",
      primary: true,
    });
  } else if (openRiskCount === 0) {
    actions.push({
      id: "log-risk",
      label: "Log another season risk",
      detail: "Closed registers still need new season risks as schedule and supply change.",
      href: "#risk-burndown-log-risk",
      primary: true,
    });
  } else {
    actions.push({
      id: "register",
      label: "Review open risks",
      detail: `${openRiskCount} open risk${openRiskCount === 1 ? "" : "s"} with real L×I.`,
      href: "#risk-burndown-register",
      primary: true,
    });
  }

  actions.push(
    {
      id: "risks",
      label: "Open Risks",
      detail: "Keep the season risk register in sync with burndown closures.",
      href: withOrgHref("/risks", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Link failure modes to open risks you are still burning down.",
      href: hubHref("/team", "fmea", orgId),
    },
  );

  return actions.slice(0, 5);
}
