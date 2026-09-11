import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Control Map (never DEMO bindings). */
export const CONTROL_MAP_RELATED_LINKS = [
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "fmea", label: "FMEA", kind: "build" as const, tab: "fmea" },
  { id: "practice", label: "Practice", kind: "team" as const, tab: "practice" },
  { id: "auto-routines", label: "Autos", kind: "path" as const, path: "/auto-routines" },
  { id: "code", label: "Code", kind: "build" as const, tab: "code" },
] as const;

export type ControlMapRelatedId = (typeof CONTROL_MAP_RELATED_LINKS)[number]["id"];

export type ControlMapRelatedLink = {
  id: ControlMapRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Subsystems / FMEA first (button map ↔ robot systems). */
export const CONTROL_MAP_RELATED_INCLUDE: ControlMapRelatedId[] = [
  "subsystems",
  "fmea",
  "practice",
];

/**
 * Soft-UI cross-links from Control Map → Subsystems / FMEA / Practice.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function controlMapRelatedLinks(
  orgId?: string | null,
  options?: { active?: ControlMapRelatedId; include?: ControlMapRelatedId[] },
): ControlMapRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CONTROL_MAP_RELATED_LINKS.filter((link) => {
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

export type ControlMapShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ControlMapNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ControlMapEmptyCopy = {
  kind: ControlMapShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real binding counts only — never invent DEMO controller totals. */
export function formatControlMapMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Control Map Soft-UI shell — never invents DEMO bindings. */
export function classifyControlMapShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  orgId?: string | null;
  bindingCount?: number;
}): ControlMapShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.bindingCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO bindings. */
export function controlMapShellCopy(kind: ControlMapShellKind): ControlMapEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading control map…",
        description: "Checking which team you are on and saved bindings.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the control map",
        description:
          "A network or server issue blocked bindings. Retry, or open Subsystems / FMEA while Control Map is down.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before mapping driver and operator inputs.",
      };
    case "empty":
      return {
        kind,
        badge: "No bindings yet",
        title: "Map your first controller input",
        description:
          "The cheat sheet stays blank until you save a real input → action. Cross-check Subsystems and FMEA so buttons match robot systems.",
      };
    default:
      return {
        kind: "ready",
        title: "Driver control map",
        description:
          "Bindings come only from inputs your drive team recorded this season. Keep them in sync with robot code, Subsystems, and FMEA.",
      };
  }
}

/**
 * Soft-UI next actions for Control Map empty/setup shells.
 * Points at Subsystems / FMEA / Practice — never invents DEMO bindings.
 */
export function controlMapNextActions(input: {
  orgId?: string | null;
  shell: ControlMapShellKind;
  bindingCount?: number;
  driverCount?: number;
  operatorCount?: number;
}): ControlMapNextAction[] {
  const orgId = input.orgId ?? null;
  const bindingCount = input.bindingCount ?? 0;
  const driverCount = input.driverCount ?? 0;
  const operatorCount = input.operatorCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before mapping controls.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Subsystem specs stay empty until you author them.",
          href: withOrgHref("/subsystems", null),
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
          detail: "Driver sessions stay empty until logged.",
          href: hubHref("/team", "practice", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Control Map can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Name drivetrain, intake, and scoring so button actions stay grounded.",
        href: withOrgHref("/subsystems", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "High-risk actuators often need the clearest driver-station labels.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "Schedule field time after the map exists so drivers rehearse real bindings.",
        href: hubHref("/team", "practice", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Control Map",
        detail: "Reload real bindings.",
        href: withOrgHref("/control-map", orgId),
        primary: true,
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Specs stay available while Control Map is down.",
        href: withOrgHref("/subsystems", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Review failure modes while bindings reload.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || bindingCount === 0) {
    return [
      {
        id: "add-binding",
        label: "Add a binding",
        detail: "Pick a controller input and the action it triggers — only real text becomes a row.",
        href: "#control-map-form",
        primary: true,
      },
      {
        id: "subsystems",
        label: "Cross-check Subsystems",
        detail: "Actions should name real robot systems, not invented mechanisms.",
        href: withOrgHref("/subsystems", orgId),
      },
      {
        id: "fmea",
        label: "Scan FMEA modes",
        detail: "Risky actuators deserve the most obvious driver-station labels.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "practice",
        label: "Open Practice",
        detail: "After you map controls, log driver sessions against the real sheet.",
        href: hubHref("/team", "practice", orgId),
      },
    ].slice(0, 4);
  }

  const actions: ControlMapNextAction[] = [];

  if (driverCount === 0) {
    actions.push({
      id: "driver",
      label: "Map driver controls",
      detail: "Operator rows exist, but the driver controller is still blank — add drive-team inputs.",
      href: "#control-map-form",
      primary: true,
    });
  } else if (operatorCount === 0) {
    actions.push({
      id: "operator",
      label: "Map operator controls",
      detail: "Driver bindings exist — add operator intake/scoring inputs so both sticks are covered.",
      href: "#control-map-form",
      primary: true,
    });
  }

  actions.push(
    {
      id: "subsystems",
      label: "Cross-check Subsystems",
      detail: "Confirm each command still matches a live robot subsystem.",
      href: withOrgHref("/subsystems", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "When a binding changes a high-RPN mechanism, update failure notes too.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "practice",
      label: "Open Practice",
      detail: "Rehearse the printed cheat sheet on the field — reps stay blank until logged.",
      href: hubHref("/team", "practice", orgId),
    },
    {
      id: "auto-routines",
      label: "Open Autos",
      detail: "Autonomous routines stay separate from teleop button maps.",
      href: withOrgHref("/auto-routines", orgId),
    },
  );

  return actions.slice(0, 5);
}
