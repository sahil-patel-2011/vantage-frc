import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Repeat Failure Patterns (never DEMO clusters). */
export const FAILURE_PATTERNS_RELATED_LINKS = [
  { id: "fmea", label: "Failure log", tab: "fmea" },
  { id: "spare-robot-kit", label: "Spare Kit", tab: "spare-robot-kit" },
  { id: "incident-heatmap", label: "Incident Heatmap", tab: "incident-heatmap" },
  { id: "pit-repair-triage", label: "Pit Triage", hub: "/competition" as const, tab: "pit-repair-triage" },
] as const;

export type FailurePatternsRelatedId = (typeof FAILURE_PATTERNS_RELATED_LINKS)[number]["id"];

export type FailurePatternsRelatedLink = {
  id: FailurePatternsRelatedId;
  label: string;
  href: string;
};

export const FAILURE_PATTERNS_RELATED_INCLUDE: FailurePatternsRelatedId[] = [
  "fmea",
  "spare-robot-kit",
  "incident-heatmap",
];

export function failurePatternsRelatedLinks(
  orgId?: string | null,
  options?: { active?: FailurePatternsRelatedId; include?: FailurePatternsRelatedId[] },
): FailurePatternsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FAILURE_PATTERNS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    const hubPath = "hub" in link ? link.hub : "/build";
    return {
      id: link.id,
      label: link.label,
      href: hubHref(hubPath, link.tab, orgId),
    };
  });
}

export type FailurePatternsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type FailurePatternsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type FailurePatternsEmptyCopy = {
  kind: FailurePatternsShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type FailurePatternsSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function failurePatternsSetupSteps(orgId?: string | null): FailurePatternsSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open failure clusters.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Log real subsystem failures — clusters only form from logged events.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "triage",
      label: "Open Repair triage",
      detail: "Pit failures feed the same subsystem history.",
      href: hubHref("/competition", "pit-repair-triage", orgId),
    },
  ];
}

export function formatFailurePatternsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowFailurePatternsSummaryTiles(eventCount: number, clusterCount: number): boolean {
  return eventCount > 0 || clusterCount > 0;
}

export function classifyFailurePatternsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  clusterCount?: number;
}): FailurePatternsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.clusterCount ?? 0) === 0) return "empty";
  return "ready";
}

export function failurePatternsShellCopy(kind: FailurePatternsShellKind): FailurePatternsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Repeat Failure Patterns…",
        description: "Checking which team you are on and Failure log history.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load failure patterns",
        description:
          "A network or server issue blocked clustering. Retry, or open Failure log while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before clustering.",
      };
    case "empty":
      return {
        kind,
        badge: "No failures logged",
        title: "Log failures or incidents",
        description: "Clusters appear only after real failures are logged.",
      };
    default:
      return {
        kind: "ready",
        title: "Repeat failure clusters",
        description: "Clusters from logged Failure log and incidents only.",
      };
  }
}

export function failurePatternsNextActions(input: {
  orgId?: string | null;
  shell: FailurePatternsShellKind;
  clusterCount?: number;
  criticalCount?: number;
}): FailurePatternsNextAction[] {
  const orgId = input.orgId ?? null;
  const clusterCount = input.clusterCount ?? 0;
  const criticalCount = input.criticalCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging failures.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "fmea",
          label: "Open Failure log",
          detail: "Failure history stays blank until your team logs modes.",
          href: hubHref("/build", "fmea", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so failure patterns can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Log subsystem failures that drive clusters.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Failure Patterns",
        detail: "Reload real Failure log clusters.",
        href: withOrgHref("/failure-patterns", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Failure log stays available while clusters reload.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || clusterCount === 0) {
    return [
      {
        id: "fmea",
        label: "Log failures",
        detail: "Clusters stay blank until failures are logged.",
        href: hubHref("/build", "fmea", orgId),
        primary: true,
      },
      {
        id: "triage",
        label: "Open Repair triage",
        detail: "Log pit failures that feed subsystem history.",
        href: hubHref("/competition", "pit-repair-triage", orgId),
      },
      {
        id: "spare-kit",
        label: "Open Spare Robot Kit",
        detail: "Pack lists stay empty until Failure log history exists.",
        href: hubHref("/build", "spare-robot-kit", orgId),
      },
    ];
  }

  return [
    {
      id: criticalCount > 0 ? "review-critical" : "review-clusters",
      label: criticalCount > 0 ? "Review critical clusters" : "Review failure clusters",
      detail:
        criticalCount > 0
          ? `${criticalCount} critical cluster${criticalCount === 1 ? "" : "s"} from logged failures.`
          : `${clusterCount} subsystem cluster${clusterCount === 1 ? "" : "s"} from real events.`,
      href: "#failure-patterns-clusters",
      primary: true,
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Refresh failure history that drives clusters.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "spare-kit",
      label: "Open Spare Robot Kit",
      detail: "Pack spares for repeating failure modes.",
      href: hubHref("/build", "spare-robot-kit", orgId),
    },
  ];
}
