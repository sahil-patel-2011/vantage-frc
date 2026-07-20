import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pit Repair Triage (never DEMO fix/swap calls). */
export const PIT_REPAIR_TRIAGE_RELATED_LINKS = [
  { id: "command", label: "Command", tab: "command" },
  { id: "fmea", label: "FMEA", hub: "/build" as const, tab: "fmea" },
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

export function pitRepairTriageSetupSteps(orgId?: string | null): PitRepairTriageSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — triage reports are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Prior failure history grounds fix-vs-swap calls.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inventory",
      label: "Open Inventory",
      detail: "Spare stock on hand drives swap recommendations.",
      href: withOrgHref("/inventory", orgId),
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Match countdown informs minutes-until-next-match triage.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
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
        title: "Loading Pit Repair Triage…",
        description: "Checking workspace membership, FMEA history, and spares — never DEMO triage calls.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Pit Repair Triage",
        description:
          "A network or server issue blocked triage. Retry, or open FMEA while it reloads — never invent DEMO calls.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pit Repair Triage is org-scoped. Pick a workspace before logging failures — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No reports yet",
        title: "Log your first pit failure",
        description:
          "Fix-vs-swap calls use real FMEA history and spare stock — never DEMO triage packs.",
      };
    default:
      return {
        kind: "ready",
        title: "Pit repair triage",
        description: "Reports from logged failures only — never DEMO confidence scores.",
      };
  }
}

export function pitRepairTriageNextActions(input: {
  orgId?: string | null;
  shell: PitRepairTriageShellKind;
  reportCount?: number;
  openCount?: number;
}): PitRepairTriageNextAction[] {
  const orgId = input.orgId ?? null;
  const reportCount = input.reportCount ?? 0;
  const openCount = input.openCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Triage reports are org-scoped — pick a team before logging failures.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Prior failure history stays blank until modes are logged.",
          href: hubHref("/build", "fmea", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Pit Repair Triage can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Log subsystem failures that ground triage.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Pit Repair Triage",
        detail: "Reload real triage reports — nothing is invented while this fails.",
        href: withOrgHref("/pit-repair-triage", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "FMEA stays available while triage reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || reportCount === 0) {
    return [
      {
        id: "log-failure",
        label: "Log a pit failure",
        detail: "Reports stay blank until you log a real failure — never DEMO triage packs.",
        href: "#pit-repair-triage-log",
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
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
    {
      id: openCount > 0 ? "resolve-open" : "review-reports",
      label: openCount > 0 ? "Resolve open triage" : "Review triage reports",
      detail:
        openCount > 0
          ? `${openCount} open report${openCount === 1 ? "" : "s"} from logged failures — never DEMO calls.`
          : `${reportCount} triage report${reportCount === 1 ? "" : "s"} from real pit failures — never DEMO counters.`,
      href: "#pit-repair-triage-reports",
      primary: true,
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Refresh failure history that grounds decisions.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "spare-kit",
      label: "Open Spare Robot Kit",
      detail: "Pre-stage pack lists beside triage swaps.",
      href: hubHref("/build", "spare-robot-kit", orgId),
    },
  ];
}
