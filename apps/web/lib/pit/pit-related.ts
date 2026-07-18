import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pit Command (never DEMO release / IR metrics). */
export const PIT_RELATED_LINKS = [
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  {
    id: "match-checklist",
    label: "Match checklist",
    kind: "competition" as const,
    tab: "match-checklist",
  },
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "pit", label: "Pit Command", kind: "path" as const, path: "/pit" },
] as const;

export type PitRelatedId = (typeof PIT_RELATED_LINKS)[number]["id"];

export type PitRelatedLink = {
  id: PitRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Batteries / Match checklist / Event Day first. */
export const PIT_RELATED_INCLUDE: PitRelatedId[] = [
  "batteries",
  "match-checklist",
  "command",
];

/**
 * Soft-UI cross-links from Pit Command → Batteries / Match checklist / Event Day.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function pitRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: PitRelatedId;
    include?: PitRelatedId[];
  },
): PitRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PIT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type PitShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PitNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PitEmptyCopy = {
  kind: PitShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO release metrics. */
export type PitSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function pitSetupSteps(orgId?: string | null): PitSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Pit Command is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "IR, voltage, and cycles stay blank until you log them — never DEMO health scores.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "match-checklist",
      label: "Open Match checklist",
      detail: "Timed pit prep stays blank until you check real items — never DEMO progress.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Active event and match queues stay empty until TBA context syncs — never DEMO schedules.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real issue / maintenance / battery counts only — never invent DEMO totals. */
export function formatPitMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Ready/active battery ratio — blank when no active packs (avoids DEMO 0/0). */
export function formatPitBatteryReady(
  ready: unknown,
  active: unknown,
  loaded: boolean,
): string {
  if (!loaded) return "…";
  const activeN = Number(active ?? 0);
  if (!Number.isFinite(activeN) || activeN <= 0) return "—";
  const readyN = Number(ready ?? 0);
  if (!Number.isFinite(readyN) || readyN < 0) return `0/${Math.floor(activeN)}`;
  return `${Math.floor(readyN)}/${Math.floor(activeN)}`;
}

/** Hide zeroed gate tiles when the pit board has no logged evidence. */
export function shouldShowPitSummaryTiles(input: {
  batteryCount: number;
  openIssues: number;
  maintenanceCount: number;
}): boolean {
  return input.batteryCount > 0 || input.openIssues > 0 || input.maintenanceCount > 0;
}

/** True when the board has no batteries, issues, or maintenance — Soft-UI empty. */
export function isPitBoardEmpty(input: {
  batteryCount: number;
  openIssues: number;
  maintenanceCount: number;
}): boolean {
  return input.batteryCount === 0 && input.openIssues === 0 && input.maintenanceCount === 0;
}

/** Classify Pit Command Soft-UI shell — never invents DEMO release metrics. */
export function classifyPitShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  batteryCount?: number;
  openIssues?: number;
  maintenanceCount?: number;
}): PitShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  if (
    isPitBoardEmpty({
      batteryCount: input.batteryCount ?? 0,
      openIssues: input.openIssues ?? 0,
      maintenanceCount: input.maintenanceCount ?? 0,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO release or IR metrics. */
export function pitShellCopy(kind: PitShellKind): PitEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Pit Command…",
        description:
          "Checking workspace membership and real issues / maintenance / battery logs — never DEMO release gates.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Pit Command",
        description:
          "A network or server issue blocked the release board. Retry, or open Batteries / Match checklist / Event Day while it reloads — never invent DEMO IR or readiness metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pit Command is org-scoped. Pick a workspace before logging batteries, issues, or maintenance — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No pit evidence yet",
        title: "Log the first battery, issue, or work item",
        description:
          "Release gates, rack status, and work queues stay blank until you record real evidence. Cross-check Batteries, Match checklist, and Event Day — never DEMO volts or readiness %.",
      };
    default:
      return {
        kind: "ready",
        title: "Robot release board",
        description:
          "Gates use only logged issues, maintenance, and battery readings — never DEMO release metrics.",
      };
  }
}

/**
 * Soft-UI next actions for Pit Command empty/setup shells.
 * Points at Batteries / Match checklist / Event Day — never invents DEMO metrics.
 */
export function pitNextActions(input: {
  orgId?: string | null;
  shell: PitShellKind;
  batteryCount?: number;
  openIssues?: number;
  overdueMaintenance?: number;
  readyBatteries?: number;
  activeBatteries?: number;
}): PitNextAction[] {
  const orgId = input.orgId ?? null;
  const batteryCount = input.batteryCount ?? 0;
  const openIssues = input.openIssues ?? 0;
  const overdueMaintenance = input.overdueMaintenance ?? 0;
  const readyBatteries = input.readyBatteries ?? 0;
  const activeBatteries = input.activeBatteries ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pit release evidence is org-scoped — pick a team before logging the board.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "batteries",
          label: "Open Batteries",
          detail: "IR and cycles stay blank until logged — never DEMO health scores.",
          href: hubHref("/team", "batteries", null),
        },
        {
          id: "match-checklist",
          label: "Open Match checklist",
          detail: "Timed pit prep stays blank until you check real items — never DEMO progress.",
          href: hubHref("/competition", "match-checklist", null),
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Match queues stay empty until an active event syncs — never DEMO schedules.",
          href: hubHref("/competition", "command", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Pit Command can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Log IR and cycle evidence for the same fleet.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Timed pre-match prep shares the same pit context.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Confirm the active event before expecting next-match countdowns.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Pit Command",
        detail: "Reload real issues / batteries / maintenance — nothing is invented while this fails.",
        href: withOrgHref("/pit", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Pack logs stay available while the release board reloads.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Timed pit runs stay available while Pit Command reloads.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Event Day queues stay available while the release board reloads.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (batteryCount === 0 && openIssues === 0)) {
    return [
      {
        id: "log-battery",
        label: "Log a battery reading",
        detail: "Voltage and IR stay blank until you measure a real pack — never DEMO volts.",
        href: "#pit-actions",
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Register packs and IR on the Team Batteries board — never DEMO health scores.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Timed bumper / battery / tether checks stay blank until you start a run.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Confirm the active event so next-match context can appear on the board.",
        href: hubHref("/competition", "command", orgId),
      },
    ].slice(0, 4);
  }

  const actions: PitNextAction[] = [];

  if (openIssues > 0) {
    actions.push({
      id: "open-issues",
      label: "Review open issues",
      detail: `${openIssues} open issue${openIssues === 1 ? "" : "s"} on the board — resolve with real verification notes, never DEMO severity.`,
      href: "#pit-issues",
      primary: true,
    });
  } else if (overdueMaintenance > 0) {
    actions.push({
      id: "overdue-maintenance",
      label: "Clear overdue maintenance",
      detail: `${overdueMaintenance} overdue item${overdueMaintenance === 1 ? "" : "s"} from real due times — complete before release.`,
      href: "#pit-maintenance",
      primary: true,
    });
  } else if (activeBatteries > 0 && readyBatteries < activeBatteries) {
    const short = activeBatteries - readyBatteries;
    actions.push({
      id: "battery-review",
      label: "Review battery rack",
      detail: `${short} active pack${short === 1 ? "" : "s"} need a fresh reading or service — never DEMO IR thresholds.`,
      href: "#pit-batteries",
      primary: true,
    });
  } else {
    actions.push({
      id: "refresh-gate",
      label: "Refresh release gate",
      detail: "Recompute from logged issues, maintenance, and battery evidence — never DEMO readiness %.",
      href: "#pit-actions",
      primary: true,
    });
  }

  actions.push(
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Log resistance tests and charge events on the Team Batteries board.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "match-checklist",
      label: "Open Match checklist",
      detail: "Turn a GO gate into timed pre-match pit runs — never DEMO checklist progress.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Match schedule and pit queues share the same event context.",
      href: hubHref("/competition", "command", orgId),
    },
  );

  return actions.slice(0, 5);
}
