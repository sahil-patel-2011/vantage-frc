import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for CAD Change Impact Radar (never DEMO revision diffs). */
export const CAD_CHANGE_RADAR_RELATED_LINKS = [
  { id: "cad", label: "CAD", tab: "cad" },
  { id: "fmea", label: "FMEA", tab: "fmea" },
  { id: "prototype", label: "Prototypes", tab: "prototype" },
  { id: "readiness-score", label: "Readiness Score", tab: "readiness-score" },
] as const;

export type CadChangeRadarRelatedId = (typeof CAD_CHANGE_RADAR_RELATED_LINKS)[number]["id"];

export type CadChangeRadarRelatedLink = {
  id: CadChangeRadarRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — CAD / FMEA / Prototypes. */
export const CAD_CHANGE_RADAR_RELATED_INCLUDE: CadChangeRadarRelatedId[] = [
  "cad",
  "fmea",
  "prototype",
];

/**
 * Soft-UI cross-links from CAD Change Radar → CAD / FMEA / Prototypes.
 * Build with hubHref — never broken JSX href templates.
 */
export function cadChangeRadarRelatedLinks(
  orgId?: string | null,
  options?: { active?: CadChangeRadarRelatedId; include?: CadChangeRadarRelatedId[] },
): CadChangeRadarRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CAD_CHANGE_RADAR_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type CadChangeRadarShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type CadChangeRadarNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CadChangeRadarEmptyCopy = {
  kind: CadChangeRadarShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type CadChangeRadarSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function cadChangeRadarSetupSteps(orgId?: string | null): CadChangeRadarSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open change radar.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Connect Onshape and confirm workspace context.",
      href: hubHref("/build", "cad", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Risk owners stay blank until real failure modes exist.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "prototype",
      label: "Open Prototypes",
      detail: "Prototype trackers stay empty until real builds are logged.",
      href: hubHref("/build", "prototype", orgId),
    },
  ];
}

/** Real snapshot / diff counts only — never invent DEMO totals. */
export function formatCadChangeRadarMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is tracked — avoids DEMO counters. */
export function shouldShowCadChangeRadarSummaryTiles(
  snapshotCount: number,
  diffCount: number,
): boolean {
  return snapshotCount > 0 || diffCount > 0;
}

/** Classify CAD Change Radar Soft-UI shell — never invents DEMO revision diffs. */
export function classifyCadChangeRadarShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  snapshotCount?: number;
  diffCount?: number;
}): CadChangeRadarShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.snapshotCount ?? 0) === 0 && (input.diffCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO revision diffs. */
export function cadChangeRadarShellCopy(kind: CadChangeRadarShellKind): CadChangeRadarEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading CAD Change Impact Radar…",
        description: "Checking workspace membership and Onshape connection.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load CAD Change Impact Radar",
        description:
          "A network or server issue blocked change radar. Retry, or open CAD while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Connect Onshape and select a workspace",
        description:
          "Change radar needs an org and CAD connection. Snapshots stay blank until a real revision is recorded.",
      };
    case "empty":
      return {
        kind,
        badge: "No snapshots yet",
        title: "Record the first tracked revision",
        description:
          "Envelope dims, mounts, mass, and ratios appear once you snapshot a real Onshape release.",
      };
    default:
      return {
        kind: "ready",
        title: "Release diffs from real snapshots",
        description:
          "Notifications fan out only when tracked parts change.",
      };
  }
}

/**
 * Soft-UI next actions for CAD Change Radar empty/setup shells.
 * Points at CAD / FMEA / Prototypes — never invents DEMO revision diffs.
 */
export function cadChangeRadarNextActions(input: {
  orgId?: string | null;
  shell: CadChangeRadarShellKind;
  snapshotCount?: number;
  diffCount?: number;
  unreadCount?: number;
}): CadChangeRadarNextAction[] {
  const orgId = input.orgId ?? null;
  const snapshotCount = input.snapshotCount ?? 0;
  const diffCount = input.diffCount ?? 0;
  const unreadCount = input.unreadCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pick a team before tracking parts.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Onshape connection stays blank until configured.",
          href: hubHref("/build", "cad", null),
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Risk owners stay empty until real failure modes exist.",
          href: hubHref("/build", "fmea", null),
        },
      ];
    }
    return [
      {
        id: "cad",
        label: "Open CAD",
        detail: "Connect Onshape so release snapshots can be recorded.",
        href: hubHref("/build", "cad", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Notify risk owners when tracked mounts or envelopes change.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "prototype",
        label: "Open Prototypes",
        detail: "Prototype trackers stay empty until real builds are logged.",
        href: hubHref("/build", "prototype", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry CAD Change Radar",
        detail: "Reload real revision diffs — nothing is invented while this fails.",
        href: withOrgHref("/cad-change-radar", orgId),
        primary: true,
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "CAD stays available while change radar reloads.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "FMEA stays available while change radar reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (snapshotCount === 0 && diffCount === 0)) {
    return [
      {
        id: "snapshot",
        label: "Record the first snapshot",
        detail: "Diffs stay blank until a real revision is recorded.",
        href: "#cad-change-radar-snapshot",
        primary: true,
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "Confirm Onshape workspace context before tracking parts.",
        href: hubHref("/build", "cad", orgId),
      },
      {
        id: "fmea",
        label: "Open FMEA",
        detail: "Subscribe risk owners once parts are tracked.",
        href: hubHref("/build", "fmea", orgId),
      },
    ];
  }

  return [
    {
      id: unreadCount > 0 ? "alerts" : "review-diffs",
      label: unreadCount > 0 ? "Review unread change alerts" : "Review release diffs",
      detail:
        unreadCount > 0
          ? `${unreadCount} unread alert${unreadCount === 1 ? "" : "s"} from real release diffs.`
          : `${diffCount} recorded diff${diffCount === 1 ? "" : "s"} across ${snapshotCount} snapshot${snapshotCount === 1 ? "" : "s"}.`,
      href: unreadCount > 0 ? "#cad-change-radar-alerts" : "#cad-change-radar-diffs",
      primary: true,
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Jump back to the Onshape workspace for the changed part.",
      href: hubHref("/build", "cad", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Update failure modes when mounts or envelopes shift.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "readiness-score",
      label: "Open Readiness Score",
      detail: "Carry mechanical change impact into robot readiness.",
      href: hubHref("/build", "readiness-score", orgId),
    },
  ];
}
