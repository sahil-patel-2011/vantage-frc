import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Repair triage (never DEMO fix/swap calls). */
export const PIT_REPAIR_TRIAGE_RELATED_LINKS = [
  { id: "command", label: "Command", tab: "command" },
  { id: "fmea", label: "Failure log", hub: "/build" as const, tab: "fmea" },
  { id: "failure-patterns", label: "Failure Patterns", hub: "/build" as const, tab: "failure-patterns" },
  { id: "spare-robot-kit", label: "Spare Kit", hub: "/build" as const, tab: "spare-robot-kit" },
] as const;

export type PitRepairTriageRelatedId = (typeof PIT_REPAIR_TRIAGE_RELATED_LINKS)[number]["id"];

export type PitRepairTriageRelatedLink = {
  id: PitRepairTriageRelatedId;
  label: string;
  href: string;
};

export const PIT_REPAIR_TRIAGE_RELATED_INCLUDE: PitRepairTriageRelatedId[] = [
  "command",
  "fmea",
  "spare-robot-kit",
];

export function pitRepairTriageRelatedLinks(
  orgId?: string | null,
  options?: { active?: PitRepairTriageRelatedId; include?: PitRepairTriageRelatedId[] },
): PitRepairTriageRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PIT_REPAIR_TRIAGE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    const hubPath = "hub" in link ? link.hub : "/competition";
    return {
      id: link.id,
      label: link.label,
      href: hubHref(hubPath, link.tab, orgId),
    };
  });
}

export type PitRepairTriageShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PitRepairTriageNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PitRepairTriageEmptyCopy = {
  kind: PitRepairTriageShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type PitRepairTriageSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function pitRepairTriageRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    pitRepairTriageRelatedLinks(orgId, {
      include: [...PIT_REPAIR_TRIAGE_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = pitRepairTriageRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function pitRepairTriageSetupSteps(orgId?: string | null): PitRepairTriageSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open triage reports.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "inventory",
      label: "Open Inventory",
      detail: "Spare stock on hand drives swap recommendations.",
      href: withOrgHref("/inventory", orgId),
    },
  ]);
}

export function formatPitRepairTriageMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowPitRepairTriageSummaryTiles(
  reportCount: number,
  fmeaCount: number,
  spareCount: number,
): boolean {
  return reportCount > 0 || fmeaCount > 0 || spareCount > 0;
}

export function classifyPitRepairTriageShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  reportCount?: number;
}): PitRepairTriageShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.reportCount ?? 0) === 0) return "empty";
  return "ready";
}

export function pitRepairTriageShellCopy(kind: PitRepairTriageShellKind): PitRepairTriageEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Repair triage",
        description: "Checking which team you are on, Failure log history, and spares.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Repair triage",
        description:
          "A network or server issue blocked triage. Retry, or open Failure log while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging failures.",
      };
    case "empty":
      return {
        kind,
        badge: "No reports yet",
        title: "Log your first pit failure",
        description:
          "Fix-vs-swap calls use real Failure log history and spare stock.",
      };
    default:
      return {
        kind: "ready",
        title: "Repair triage",
        description: "Reports from logged failures only.",
      };
  }
}

export function pitRepairTriageNextActions(input: {
  orgId?: string | null;
  shell: PitRepairTriageShellKind;
  reportCount?: number;
  openCount?: number;
  reinspectReports?: Array<{ subsystemName: string; decision: "fix" | "swap" | "monitor"; status: "open" | "staged" | "resolved" }>;
}): PitRepairTriageNextAction[] {
  const orgId = input.orgId ?? null;
  const reportCount = input.reportCount ?? 0;
  const openCount = input.openCount ?? 0;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(pitRepairTriageSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Repair triage",
        detail: "Reload real triage reports.",
        href: withOrgHref("/pit-repair-triage", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Failure log stays available while triage reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || reportCount === 0) {
    return [
      {
        id: "log-failure",
        label: "Log a pit failure",
        detail: "Reports stay blank until you log a real failure.",
        href: "#pit-repair-triage-log",
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Prior failures ground fix-vs-swap confidence.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Spare stock drives swap recommendations.",
        href: withOrgHref("/inventory", orgId),
      },
    ];
  }

  return [
    ...(input.reinspectReports && input.reinspectReports.length > 0
      ? [
          {
            id: "reinspect",
            label: `Get ${input.reinspectReports[0]!.subsystemName} reinspected before queue`,
            detail:
              "I104: a logged fix or swap is a robot change — inspectors treat it as a new configuration until they sign it.",
            href: "#pit-repair-triage-reports",
            primary: true,
          } satisfies PitRepairTriageNextAction,
        ]
      : [
          {
            id: openCount > 0 ? "resolve-open" : "review-reports",
            label: openCount > 0 ? "Resolve open triage" : "Review triage reports",
            detail:
              openCount > 0
                ? `${openCount} open report${openCount === 1 ? "" : "s"} from logged failures.`
                : `${reportCount} triage report${reportCount === 1 ? "" : "s"} from real pit failures.`,
            href: "#pit-repair-triage-reports",
            primary: true,
          } satisfies PitRepairTriageNextAction,
        ]),
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Refresh failure history that grounds decisions.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "spare-kit",
      label: "Open Spare kit",
      detail: "Pre-stage pack lists beside triage swaps.",
      href: hubHref("/build", "spare-robot-kit", orgId),
    },
  ];
}
