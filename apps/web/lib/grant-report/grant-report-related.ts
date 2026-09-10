import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Grant Report (never DEMO grant dollars). */
export const GRANT_REPORT_RELATED_LINKS = [
  { id: "grants", label: "Business · Grants", kind: "business" as const, tab: "grants" },
  { id: "grant-workbench", label: "Grants workbench", kind: "path" as const, path: "/team/grants" },
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "writer", label: "Writer", kind: "ai" as const, tab: "writer" },
] as const;

export type GrantReportRelatedId = (typeof GRANT_REPORT_RELATED_LINKS)[number]["id"];

export type GrantReportRelatedLink = {
  id: GrantReportRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Grants / Grants workbench / Community Impact. */
export const GRANT_REPORT_RELATED_INCLUDE: GrantReportRelatedId[] = [
  "grants",
  "grant-workbench",
  "impact",
];

/**
 * Soft-UI cross-links from Grant Report → Grants / Impact.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function grantReportRelatedLinks(
  orgId?: string | null,
  options?: { active?: GrantReportRelatedId; include?: GrantReportRelatedId[] },
): GrantReportRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return GRANT_REPORT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "business") {
      return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
    }
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type GrantReportShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type GrantReportNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type GrantReportEmptyCopy = {
  kind: GrantReportShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO grant dollars. */
export type GrantReportSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function grantReportSetupSteps(orgId?: string | null): GrantReportSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open grant reports.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "grants",
      label: "Open Grants",
      detail: "Awarded amounts stay blank until real grants land.",
      href: hubHref("/business", "grants", orgId),
    },
    {
      id: "grant-workbench",
      label: "Open Grants workbench",
      detail: "Track applications and mark awards before generating reports.",
      href: withOrgHref("/team/grants", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Outreach stays blank until your team logs it.",
      href: hubHref("/business", "impact", orgId),
    },
  ];
}

/** Real granted / report counts only — never invent DEMO totals. */
export function formatGrantReportMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Awarded USD — blank until a real awarded amount exists; never invent DEMO dollars. */
export function formatGrantReportUsd(value: unknown, hasAward: boolean): string {
  if (!hasAward) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Hide zeroed summary tiles when nothing is awarded yet — avoids DEMO counters. */
export function shouldShowGrantReportSummaryTiles(input: {
  eligibleCount: number;
  reportCount: number;
}): boolean {
  return input.eligibleCount > 0 || input.reportCount > 0;
}

/** True when the team has no awarded grants and no reports — Soft-UI empty. */
export function isGrantReportBoardEmpty(input: {
  eligibleCount: number;
  reportCount: number;
}): boolean {
  return input.eligibleCount === 0 && input.reportCount === 0;
}

/** Classify Grant Report Soft-UI shell — never invents DEMO grant dollars. */
export function classifyGrantReportShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eligibleCount?: number;
  reportCount?: number;
}): GrantReportShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (isGrantReportBoardEmpty({
    eligibleCount: input.eligibleCount ?? 0,
    reportCount: input.reportCount ?? 0,
  })) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO grant dollars. */
export function grantReportShellCopy(kind: GrantReportShellKind): GrantReportEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Grant Report…",
        description:
          "Checking which team you are on and awarded grants.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Grant Report",
        description:
          "A network or server issue blocked the report board. Retry, or open Grants / Community Impact while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team and mark real awards before generating.",
      };
    case "empty":
      return {
        kind,
        badge: "No awarded grants yet",
        title: "Mark a grant as awarded to generate a report",
        description:
          "Post-grant reports stay blank until Grants tracks an awarded application. Cross-check Grants workbench and Community Impact.",
      };
    default:
      return {
        kind: "ready",
        title: "Post-grant impact reports",
        description:
          "Reports cite only awarded amounts, logged outreach, and recorded spend.",
      };
  }
}

/**
 * Soft-UI next actions for Grant Report empty/setup shells.
 * Points at Grants / Impact — never invents DEMO grant dollars.
 */
export function grantReportNextActions(input: {
  orgId?: string | null;
  shell: GrantReportShellKind;
  eligibleCount?: number;
  reportCount?: number;
}): GrantReportNextAction[] {
  const orgId = input.orgId ?? null;
  const eligibleCount = input.eligibleCount ?? 0;
  const reportCount = input.reportCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of grantReportSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(grantReportSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Grant Report",
        detail: "Reload real awarded grants and reports.",
        href: withOrgHref("/grant-report", orgId),
        primary: true,
      },
      {
        id: "grants",
        label: "Open Grants",
        detail: "Grant rows stay available while the report board reloads.",
        href: hubHref("/business", "grants", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact rows stay available while the report board reloads.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  if (input.shell === "empty" || eligibleCount === 0) {
    return [
      {
        id: "grants",
        label: "Track awarded grants",
        detail: "Reports stay blank until Grants marks a real award.",
        href: hubHref("/business", "grants", orgId),
        primary: true,
      },
      {
        id: "grant-workbench",
        label: "Open Grants workbench",
        detail: "Mark applications awarded before generating post-grant reports.",
        href: withOrgHref("/team/grants", orgId),
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Ground funder narratives in real logged outreach.",
        href: hubHref("/business", "impact", orgId),
      },
    ];
  }

  const actions: GrantReportNextAction[] = [
    {
      id: "generate",
      label: reportCount > 0 ? "Generate another report" : "Generate a report",
      detail:
        eligibleCount > 0
          ? `${eligibleCount} awarded grant${eligibleCount === 1 ? "" : "s"} on record — cite only real award dollars.`
          : "Compose from awarded grants and logged outreach.",
      href: "#grant-report-eligible",
      primary: true,
    },
    {
      id: "grants",
      label: "Open Grants",
      detail: "Keep award status grounded in real grant decisions.",
      href: hubHref("/business", "grants", orgId),
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Keep funder narratives grounded in real outreach.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Pair report language with grant copy.",
      href: hubHref("/ai", "writer", orgId),
    },
  ];

  if (reportCount > 0) {
    actions.splice(1, 0, {
      id: "review-reports",
      label: "Review reports",
      detail: `${reportCount} report${reportCount === 1 ? "" : "s"} from real awards.`,
      href: "#grant-report-list",
    });
  }

  return actions.slice(0, 5);
}
