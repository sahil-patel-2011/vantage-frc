import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Inspection Copilot (never DEMO risk scores). */
export const INSPECTION_COPILOT_RELATED_LINKS = [
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  { id: "fmea", label: "FMEA", kind: "build" as const, tab: "fmea" },
  { id: "weigh-in", label: "Weigh-in", kind: "build" as const, tab: "robot-weigh-in" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "inspection", label: "Inspection", kind: "path" as const, path: "/inspection" },
  { id: "match-checklist", label: "Match checklist", kind: "path" as const, path: "/match-checklist" },
] as const;

export type InspectionCopilotRelatedId = (typeof INSPECTION_COPILOT_RELATED_LINKS)[number]["id"];

export type InspectionCopilotRelatedLink = {
  id: InspectionCopilotRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Batteries / FMEA / Weigh-in. */
export const INSPECTION_COPILOT_RELATED_INCLUDE: InspectionCopilotRelatedId[] = [
  "batteries",
  "fmea",
  "weigh-in",
];

/**
 * Soft-UI cross-links from Inspection Copilot → Batteries / FMEA / Weigh-in.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function inspectionCopilotRelatedLinks(
  orgId?: string | null,
  options?: { active?: InspectionCopilotRelatedId; include?: InspectionCopilotRelatedId[] },
): InspectionCopilotRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return INSPECTION_COPILOT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type InspectionCopilotShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type InspectionCopilotNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type InspectionCopilotEmptyCopy = {
  kind: InspectionCopilotShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real check / flag counts only — never invent DEMO inspection metrics. */
export function formatInspectionCopilotMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real risk score as percent — blank until a check exists (never DEMO %). */
export function formatInspectionRiskPct(value: unknown, loaded: boolean, hasChecks: boolean): string {
  if (!loaded || !hasChecks) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Classify Inspection Copilot Soft-UI shell — never invents DEMO risk scores. */
export function classifyInspectionCopilotShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  checkCount?: number;
}): InspectionCopilotShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.checkCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO inspection metrics. */
export function inspectionCopilotShellCopy(kind: InspectionCopilotShellKind): InspectionCopilotEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading inspection copilot…",
        description:
          "Checking which team you are on and logged readiness checks.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the inspection copilot",
        description:
          "A network or server issue blocked readiness checks. Retry, or open Batteries / FMEA / Subsystems while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before comparing limits to measured robot values.",
      };
    case "empty":
      return {
        kind,
        badge: "No checks yet",
        title: "Run your first inspection-readiness check",
        description:
          "Risk and flags stay blank until you enter a real weight budget, frame/bumper measurements, and wiring/power state. Cross-check Batteries, FMEA, and Subsystems.",
      };
    default:
      return {
        kind: "ready",
        title: "Inspection-readiness checks",
        description:
          "Predictions use only the limits and measurements your team logged. Resolve critical flags before travel.",
      };
  }
}

/**
 * Soft-UI next actions for Inspection Copilot empty/setup shells.
 * Points at Batteries / FMEA / Subsystems — never invents DEMO risk scores.
 */
export function inspectionCopilotNextActions(input: {
  orgId?: string | null;
  shell: InspectionCopilotShellKind;
  checkCount?: number;
  flaggedCount?: number;
  criticalCount?: number;
}): InspectionCopilotNextAction[] {
  const orgId = input.orgId ?? null;
  const checkCount = input.checkCount ?? 0;
  const flaggedCount = input.flaggedCount ?? 0;
  const criticalCount = input.criticalCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before predicting inspection failures.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "batteries",
          label: "Open Batteries",
          detail: "Pack health stays blank until logged.",
          href: hubHref("/team", "batteries", null),
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Failure modes stay blank until scored.",
          href: hubHref("/build", "fmea", null),
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Subsystem names stay empty until you author them.",
          href: withOrgHref("/subsystems", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Inspection Copilot can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Battery strap/secure state is part of the wiring/power checklist.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "High-RPN mechanisms often need the earliest weigh-in and bumper checks.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Name mechanisms so itemized weigh-in rows stay grounded.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Inspection Copilot",
        detail: "Reload real readiness checks.",
        href: withOrgHref("/inspection-copilot", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Pack rotation stays available while readiness reloads.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Review failure modes while checks reload.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Confirm mechanism names while readiness reloads.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "empty" || checkCount === 0) {
    return [
      {
        id: "run-check",
        label: "Run a readiness check",
        detail: "Enter real limits and measured values — only logged rows produce flags and risk.",
        href: "#inspection-copilot-form",
        primary: true,
      },
      {
        id: "batteries",
        label: "Cross-check Batteries",
        detail: "Confirm packs are secured and logged before you mark the wiring checklist.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "fmea",
        label: "Scan FMEA modes",
        detail: "Risky mechanisms deserve the earliest weigh-in and bumper verification.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Itemized weigh-in names should match real robot systems.",
        href: withOrgHref("/subsystems", orgId),
      },
    ].slice(0, 4);
  }

  const actions: InspectionCopilotNextAction[] = [];

  if (criticalCount > 0) {
    actions.push({
      id: "resolve-critical",
      label: "Resolve critical flags",
      detail: `${criticalCount} critical prediction${criticalCount === 1 ? "" : "s"} from logged measurements — fix before travel.`,
      href: "#inspection-copilot-checks",
      primary: true,
    });
  } else if (flaggedCount > 0) {
    actions.push({
      id: "review-flags",
      label: "Review warning flags",
      detail: `${flaggedCount} flagged check${flaggedCount === 1 ? "" : "s"} from real measurements — clear warnings before event day.`,
      href: "#inspection-copilot-checks",
      primary: true,
    });
  }

  actions.push(
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Keep pack secure-state and health logged.",
      href: hubHref("/team", "batteries", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "When a readiness flag touches a high-RPN subsystem, update failure notes too.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "subsystems",
      label: "Cross-check Subsystems",
      detail: "Confirm weigh-in line items still match live robot mechanisms.",
      href: withOrgHref("/subsystems", orgId),
    },
    {
      id: "match-checklist",
      label: "Open Match checklist",
      detail: "Turn resolved readiness into timed pit runs.",
      href: withOrgHref("/match-checklist", orgId),
    },
  );

  return actions.slice(0, 5);
}
