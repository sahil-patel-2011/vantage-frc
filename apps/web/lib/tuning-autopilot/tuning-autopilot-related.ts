import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Tuning Autopilot (never DEMO gain metrics). */
export const TUNING_AUTOPILOT_RELATED_LINKS = [
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "fmea", label: "FMEA", kind: "build" as const, tab: "fmea" },
  { id: "practice", label: "Practice", kind: "team" as const, tab: "practice" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "control-map", label: "Control Map", kind: "path" as const, path: "/control-map" },
] as const;

export type TuningAutopilotRelatedId = (typeof TUNING_AUTOPILOT_RELATED_LINKS)[number]["id"];

export type TuningAutopilotRelatedLink = {
  id: TuningAutopilotRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — CAD / FMEA / Practice first. */
export const TUNING_AUTOPILOT_RELATED_INCLUDE: TuningAutopilotRelatedId[] = [
  "cad",
  "fmea",
  "practice",
];

/**
 * Soft-UI cross-links from Tuning Autopilot → CAD / FMEA / Practice.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function tuningAutopilotRelatedLinks(
  orgId?: string | null,
  options?: { active?: TuningAutopilotRelatedId; include?: TuningAutopilotRelatedId[] },
): TuningAutopilotRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return TUNING_AUTOPILOT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type TuningAutopilotShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type TuningAutopilotNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type TuningAutopilotEmptyCopy = {
  kind: TuningAutopilotShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real session / iteration counts only — never invent DEMO tuning totals. */
export function formatTuningAutopilotMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real score as percent — blank until an iteration exists (never DEMO %). */
export function formatTuningScorePct(value: unknown, loaded: boolean, hasIterations: boolean): string {
  if (!loaded || !hasIterations) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Classify Tuning Autopilot Soft-UI shell — never invents DEMO gain metrics. */
export function classifyTuningAutopilotShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sessionCount?: number;
}): TuningAutopilotShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.sessionCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO gain metrics. */
export function tuningAutopilotShellCopy(kind: TuningAutopilotShellKind): TuningAutopilotEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading tuning autopilot…",
        description:
          "Checking which team you are on and logged tuning sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the tuning autopilot",
        description:
          "A network or server issue blocked tuning sessions. Retry, or open CAD / FMEA / Practice while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before logging gain sets and test results.",
      };
    case "empty":
      return {
        kind,
        badge: "No sessions yet",
        title: "Start your first tuning session",
        description:
          "Next-gain suggestions stay blank until you log a real gain set and observed test result. Cross-check CAD, FMEA, and Practice.",
      };
    default:
      return {
        kind: "ready",
        title: "Tuning sessions",
        description:
          "Suggestions use only the gain sets and test results your team logged. Cross-check CAD, FMEA, and Practice.",
      };
  }
}

/**
 * Soft-UI next actions for Tuning Autopilot empty/setup shells.
 * Points at CAD / FMEA / Practice — never invents DEMO gain metrics.
 */
export function tuningAutopilotNextActions(input: {
  orgId?: string | null;
  shell: TuningAutopilotShellKind;
  sessionCount?: number;
  iterationCount?: number;
  hasSuggestion?: boolean;
  converged?: boolean;
}): TuningAutopilotNextAction[] {
  const orgId = input.orgId ?? null;
  const sessionCount = input.sessionCount ?? 0;
  const iterationCount = input.iterationCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging gain sets.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanism geometry stays blank until connected.",
          href: hubHref("/build", "cad", null),
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Failure modes stay blank until scored.",
          href: hubHref("/build", "fmea", null),
        },
        {
          id: "practice",
          label: "Open Practice",
          detail: "Practice plans stay empty until scheduled.",
          href: hubHref("/team", "practice", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Tuning Autopilot can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm mechanism geometry before you start a subsystem tuning session.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "High-RPN mechanisms often need the earliest gain logging.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Schedule a pit block to log iterations under real robot conditions.",
        href: hubHref("/team", "practice", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Tuning Autopilot",
        detail: "Reload real tuning sessions.",
        href: withOrgHref("/tuning-autopilot", orgId),
        primary: true,
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Mechanism review stays available while sessions reload.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Review failure modes while tuning reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Confirm practice blocks while sessions reload.",
        href: hubHref("/team", "practice", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sessionCount === 0) {
    return [
      {
        id: "start-session",
        label: "Start a tuning session",
        detail: "Pick a subsystem and controller — only logged iterations produce next-gain suggestions.",
        href: "#tuning-autopilot-new-session",
        primary: true,
      },
      {
        id: "cad",
        label: "Cross-check CAD",
        detail: "Confirm the mechanism you’re tuning matches the live CAD model.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "fmea",
        label: "Scan FMEA modes",
        detail: "Risky mechanisms deserve the earliest gain logging and settle checks.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Block practice time to log real overshoot / settle / error results.",
        href: hubHref("/team", "practice", orgId),
      },
    ].slice(0, 4);
  }

  const actions: TuningAutopilotNextAction[] = [];

  if (iterationCount === 0) {
    actions.push({
      id: "log-iteration",
      label: "Log your first iteration",
      detail: "Enter a real gain set and observed test result — suggestions stay blank until then.",
      href: "#tuning-autopilot-log-iteration",
      primary: true,
    });
  } else if (input.converged) {
    actions.push({
      id: "mark-converged",
      label: "Review converged gains",
      detail: "Best-logged gains look stable — verify on the robot before marking the session converged.",
      href: "#tuning-autopilot-suggestion",
      primary: true,
    });
  } else if (input.hasSuggestion) {
    actions.push({
      id: "try-suggestion",
      label: "Try the suggested next gains",
      detail: "Next gains come only from your logged trend.",
      href: "#tuning-autopilot-suggestion",
      primary: true,
    });
  }

  actions.push(
    {
      id: "cad",
      label: "Open CAD",
      detail: "Keep mechanism geometry aligned with the subsystem you’re tuning.",
      href: hubHref("/build", "cad", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "When oscillation or overshoot touches a high-RPN mode, update failure notes too.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "practice",
      label: "Open Practice",
      detail: "Schedule another pit block to re-test the next gain set under real conditions.",
      href: hubHref("/team", "practice", orgId),
    },
    {
      id: "subsystems",
      label: "Cross-check Subsystems",
      detail: "Session subsystem names should match real robot mechanisms.",
      href: withOrgHref("/subsystems", orgId),
    },
  );

  return actions.slice(0, 5);
}
