import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Impact Essay (never DEMO essay metrics). */
export const IMPACT_ESSAY_RELATED_LINKS = [
  { id: "impact", label: "Community Impact", kind: "business" as const, tab: "impact" },
  { id: "evidence", label: "Awards", kind: "business" as const, tab: "evidence" },
  { id: "writer", label: "Writer", kind: "ai" as const, tab: "writer" },
  { id: "award-tracker", label: "Award tracker", kind: "business" as const, tab: "award-tracker" },
  { id: "judge-sim", label: "Judge-Pitch", kind: "business" as const, tab: "judge-sim" },
] as const;

export type ImpactEssayRelatedId = (typeof IMPACT_ESSAY_RELATED_LINKS)[number]["id"];

export type ImpactEssayRelatedLink = {
  id: ImpactEssayRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Community Impact / Awards / Writer first. */
export const IMPACT_ESSAY_RELATED_INCLUDE: ImpactEssayRelatedId[] = ["impact", "evidence", "writer"];

/**
 * Soft-UI cross-links from Impact Essay → Impact / Awards / Writer.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function impactEssayRelatedLinks(
  orgId?: string | null,
  options?: { active?: ImpactEssayRelatedId; include?: ImpactEssayRelatedId[] },
): ImpactEssayRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return IMPACT_ESSAY_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href:
      link.kind === "ai"
        ? hubHref("/ai", link.tab, orgId)
        : hubHref("/business", link.tab, orgId),
  }));
}

export type ImpactEssayShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ImpactEssayNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ImpactEssayEmptyCopy = {
  kind: ImpactEssayShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real outreach / draft counts only — never invent DEMO essay totals. */
export function formatImpactEssayMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real hour totals — blank until logged; never invent DEMO hours. */
export function formatImpactEssayHours(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString();
}

/** Hide zeroed fact tiles when nothing is grounded — avoids DEMO counters. */
export function shouldShowImpactEssaySummaryTiles(hasGroundedData: boolean): boolean {
  return hasGroundedData;
}

/** Classify Impact Essay Soft-UI shell — never invents DEMO essay metrics. */
export function classifyImpactEssayShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  hasGroundedData?: boolean;
}): ImpactEssayShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if (!input.hasGroundedData) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO essay metrics. */
export function impactEssayShellCopy(kind: ImpactEssayShellKind): ImpactEssayEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Impact Essay…",
        description:
          "Checking which team you are on and logged outreach records.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Impact Essay",
        description:
          "A network or server issue blocked the essay generator. Retry, or open Community Impact / Awards / Writer while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and log real outreach before drafting.",
      };
    case "empty":
      return {
        kind,
        badge: "No grounded records",
        title: "Log outreach before drafting",
        description:
          "Essay drafts stay blank until your team logs outreach, hours, sponsors, or events. Cross-check Community Impact, Awards, and Writer.",
      };
    default:
      return {
        kind: "ready",
        title: "Grounded award essay",
        description:
          "Drafts cite only records your team logged.",
      };
  }
}

/**
 * Soft-UI next actions for Impact Essay empty/setup shells.
 * Points at Impact / Awards / Writer — never invents DEMO essay metrics.
 */
export function impactEssayNextActions(input: {
  orgId?: string | null;
  shell: ImpactEssayShellKind;
  hasGroundedData?: boolean;
  draftCount?: number;
  outreachCount?: number;
}): ImpactEssayNextAction[] {
  const orgId = input.orgId ?? null;
  const hasGroundedData = input.hasGroundedData ?? false;
  const draftCount = input.draftCount ?? 0;
  const outreachCount = input.outreachCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging outreach.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "impact",
          label: "Open Community Impact",
          detail: "Outreach rows stay blank until your team logs them.",
          href: hubHref("/business", "impact", null),
        },
        {
          id: "evidence",
          label: "Open Awards",
          detail: "Award evidence stays blank until your team uploads it.",
          href: hubHref("/business", "evidence", null),
        },
        {
          id: "writer",
          label: "Open Writer",
          detail: "Grant and sponsor copy stays empty until you draft it.",
          href: hubHref("/ai", "writer", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Impact Essay can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Ground essay claims in real logged activities.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Keep award packets grounded in uploaded evidence.",
        href: hubHref("/business", "evidence", orgId),
      },
      {
        id: "writer",
        label: "Open Writer",
        detail: "Pair essay drafts with grant/sponsor language.",
        href: hubHref("/ai", "writer", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Impact Essay",
        detail: "Reload real grounded records and drafts.",
        href: withOrgHref("/impact-essay", orgId),
        primary: true,
      },
      {
        id: "impact",
        label: "Open Community Impact",
        detail: "Impact rows stay available while the essay generator reloads.",
        href: hubHref("/business", "impact", orgId),
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Award evidence stays available while the essay generator reloads.",
        href: hubHref("/business", "evidence", orgId),
      },
      {
        id: "writer",
        label: "Open Writer",
        detail: "Writer drafts stay available while the essay generator reloads.",
        href: hubHref("/ai", "writer", orgId),
      },
    ];
  }

  if (input.shell === "empty" || !hasGroundedData) {
    return [
      {
        id: "impact",
        label: "Log Community Impact",
        detail: "Outreach stays blank until real activities land.",
        href: hubHref("/business", "impact", orgId),
        primary: true,
      },
      {
        id: "evidence",
        label: "Open Awards",
        detail: "Award packets stay blank until real uploads exist.",
        href: hubHref("/business", "evidence", orgId),
      },
      {
        id: "writer",
        label: "Open Writer",
        detail: "Grant and sponsor copy stays empty until you draft it.",
        href: hubHref("/ai", "writer", orgId),
      },
    ];
  }

  const actions: ImpactEssayNextAction[] = [
    {
      id: "generate",
      label: draftCount > 0 ? "Generate another draft" : "Generate essay draft",
      detail:
        outreachCount > 0
          ? `${outreachCount} outreach activit${outreachCount === 1 ? "y" : "ies"} on record — cite only real rows.`
          : "Compose from logged hours, sponsors, or events.",
      href: "#impact-essay-generate",
      primary: true,
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Keep outreach claims grounded in real logged activities.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Keep award packets grounded in uploaded evidence.",
      href: hubHref("/business", "evidence", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Turn grounded facts into grant or sponsor language.",
      href: hubHref("/ai", "writer", orgId),
    },
  ];

  if (draftCount > 0) {
    actions.splice(1, 0, {
      id: "review-drafts",
      label: "Review drafts",
      detail: `${draftCount} draft${draftCount === 1 ? "" : "s"} from real citations.`,
      href: "#impact-essay-drafts",
    });
  }

  return actions.slice(0, 5);
}
