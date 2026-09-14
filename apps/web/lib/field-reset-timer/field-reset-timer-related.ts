import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Field Reset Timer (never DEMO drill times). */
export const FIELD_RESET_TIMER_RELATED_LINKS = [
  { id: "practice", label: "Practice", hub: "/team" as const, tab: "practice" },
  { id: "driver-tryouts", label: "Driver Tryouts", hub: "/team" as const, tab: "driver-tryouts" },
  { id: "drive-team-signals", label: "Drive-Team Signals", hub: "/competition" as const, tab: "drive-team-signals" },
  { id: "hours-self-view", label: "My Hours", hub: "/team" as const, tab: "hours-self-view" },
] as const;

export type FieldResetTimerRelatedId = (typeof FIELD_RESET_TIMER_RELATED_LINKS)[number]["id"];

export type FieldResetTimerRelatedLink = {
  id: FieldResetTimerRelatedId;
  label: string;
  href: string;
};

export const FIELD_RESET_TIMER_RELATED_INCLUDE: FieldResetTimerRelatedId[] = [
  "practice",
  "driver-tryouts",
  "drive-team-signals",
];

export function fieldResetTimerRelatedLinks(
  orgId?: string | null,
  options?: { active?: FieldResetTimerRelatedId; include?: FieldResetTimerRelatedId[] },
): FieldResetTimerRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FIELD_RESET_TIMER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref(link.hub, link.tab, orgId),
  }));
}

export type FieldResetTimerShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type FieldResetTimerNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type FieldResetTimerEmptyCopy = {
  kind: FieldResetTimerShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type FieldResetTimerSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function fieldResetTimerRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    fieldResetTimerRelatedLinks(orgId, {
      include: [...FIELD_RESET_TIMER_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = fieldResetTimerRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function fieldResetTimerSetupSteps(orgId?: string | null): FieldResetTimerSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open reset drills.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — reset drills stay empty until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
}

export function formatFieldResetTimerMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowFieldResetTimerSummaryTiles(sessionCount: number, cycleCount: number): boolean {
  return sessionCount > 0 || cycleCount > 0;
}

export function classifyFieldResetTimerShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sessionCount?: number;
}): FieldResetTimerShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.sessionCount ?? 0) === 0) return "empty";
  return "ready";
}

export function fieldResetTimerShellCopy(kind: FieldResetTimerShellKind): FieldResetTimerEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Field Reset Timer…",
        description: "Checking which team you are on and reset-drill sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Field Reset Timer",
        description:
          "A network or server issue blocked reset drills. Retry, or open Practice while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging real practice cycles.",
      };
    case "empty":
      return {
        kind,
        badge: "No sessions yet",
        title: "Start a practice reset session",
        description:
          "Create a session, then log real reset cycles as your drive team runs them.",
      };
    default:
      return {
        kind: "ready",
        title: "Field reset drills",
        description: "Sessions and cycles from your practice logs only.",
      };
  }
}

export function fieldResetTimerNextActions(input: {
  orgId?: string | null;
  shell: FieldResetTimerShellKind;
  sessionCount?: number;
  cycleCount?: number;
}): FieldResetTimerNextAction[] {
  const orgId = input.orgId ?? null;
  const sessionCount = input.sessionCount ?? 0;
  const cycleCount = input.cycleCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of fieldResetTimerSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(fieldResetTimerSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Field Reset Timer",
        detail: "Reload real practice sessions.",
        href: withOrgHref("/field-reset-timer", orgId),
        primary: true,
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Practice stays available while the timer reloads.",
        href: hubHref("/team", "practice", orgId),
      },
      {
        id: "tryouts",
        label: "Open Driver Tryouts",
        detail: "Tryout drills stay available while the timer reloads.",
        href: hubHref("/team", "driver-tryouts", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sessionCount === 0) {
    return [
      {
        id: "create-session",
        label: "Create a practice session",
        detail: "Sessions stay blank until you start one.",
        href: "#field-reset-new-session",
        primary: true,
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Schedule driver practice that feeds reset timing.",
        href: hubHref("/team", "practice", orgId),
      },
      {
        id: "signals",
        label: "Open Drive-Team Signals",
        detail: "Standardize the callouts used during reset drills.",
        href: hubHref("/competition", "drive-team-signals", orgId),
      },
    ];
  }

  return [
    {
      id: cycleCount > 0 ? "review-cycles" : "log-cycle",
      label: cycleCount > 0 ? "Review logged cycles" : "Log a reset cycle",
      detail:
        cycleCount > 0
          ? `${sessionCount} session${sessionCount === 1 ? "" : "s"} · ${cycleCount} cycle${cycleCount === 1 ? "" : "s"} from real practice.`
          : `${sessionCount} session${sessionCount === 1 ? "" : "s"} ready — log timed resets as the drive team runs them.`,
      href: cycleCount > 0 ? "#field-reset-sessions" : "#field-reset-cycles",
      primary: true,
    },
    {
      id: "practice",
      label: "Open Practice",
      detail: "Cross-check the practice calendar beside reset drills.",
      href: hubHref("/team", "practice", orgId),
    },
    {
      id: "tryouts",
      label: "Open Driver Tryouts",
      detail: "Compare tryout pacing with reset consistency.",
      href: hubHref("/team", "driver-tryouts", orgId),
    },
  ];
}
