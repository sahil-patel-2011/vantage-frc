import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type DashboardHubId =
  | "competition"
  | "team"
  | "logistics"
  | "business"
  | "build"
  | "ai";

export type DashboardHubLink = {
  id: DashboardHubId;
  label: string;
  href: string;
};

export type DashboardFeatureDesk = {
  id: string;
  label: string;
  detail: string;
  href: string;
  icon:
    | "swords"
    | "stats"
    | "clipboard"
    | "cube"
    | "grid"
    | "camera"
    | "users"
    | "bolt";
};

export type DashboardShellKind = "loading" | "no_org" | "setup" | "tba" | "ready";

export type DashboardNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DashboardSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
  state: "done" | "current" | "pending";
};

/**
 * Resolve a sensible default tab per hub so Home cross-links land on a real surface.
 */
export function dashboardHubHref(hub: DashboardHubId, orgId?: string | null): string {
  switch (hub) {
    case "competition":
      return hubHref("/competition", "command", orgId);
    case "team":
      return hubHref("/team", "calendar", orgId);
    case "business":
      return hubHref("/business", "overview", orgId);
    case "build":
      return hubHref("/build", "kickoff", orgId);
    case "ai":
      return hubHref("/ai", "chat", orgId);
    case "logistics":
      return withOrgHref("/logistics", orgId);
  }
}

/** Six-pillar Soft-UI rail — hubHref / withOrgHref only. */
export function dashboardHubLinks(orgId?: string | null): DashboardHubLink[] {
  return (
    [
      ["competition", "Competition"],
      ["team", "Team"],
      ["logistics", "Logistics"],
      ["business", "Business"],
      ["build", "Build"],
      ["ai", "AI"],
    ] as const
  ).map(([id, label]) => ({
    id,
    label,
    href: dashboardHubHref(id, orgId),
  }));
}

/**
 * Home feature desks — destinations only, never invented scores or percents.
 * Works without an org so the empty Home still opens real product surfaces.
 */
export function dashboardFeatureDesks(orgId?: string | null): DashboardFeatureDesk[] {
  return [
    {
      id: "command",
      label: "Event day",
      detail: "Schedule and pit",
      href: hubHref("/competition", "command", orgId),
      icon: "swords",
    },
    {
      id: "strategy",
      label: "Strategy",
      detail: "Predictions and matchups",
      href: hubHref("/competition", "strategy", orgId),
      icon: "stats",
    },
    {
      id: "scout",
      label: "Scouting",
      detail: "Forms and coverage",
      href: hubHref("/competition", "scouting", orgId),
      icon: "clipboard",
    },
    {
      id: "cad",
      label: "CAD",
      detail: "Onshape and Fusion",
      href: hubHref("/build", "cad", orgId),
      icon: "cube",
    },
    {
      id: "finance",
      label: "Finance",
      detail: "Budget and orders",
      href: hubHref("/business", "finance", orgId),
      icon: "grid",
    },
    {
      id: "media",
      label: "Media",
      detail: "Photos and library",
      href: hubHref("/media", "media-library", orgId),
      icon: "camera",
    },
    {
      id: "team",
      label: "Team",
      detail: "Calendar and roster",
      href: hubHref("/team", "calendar", orgId),
      icon: "users",
    },
    {
      id: "ai",
      label: "AI",
      detail: "Chat and routing",
      href: hubHref("/ai", "chat", orgId),
      icon: "bolt",
    },
  ];
}

export function classifyDashboardShell(input: {
  loaded: boolean;
  orgId?: string | null;
  setupRequired?: boolean;
  tbaConfigured?: boolean | null;
}): DashboardShellKind {
  if (!input.loaded) return "loading";
  if (!input.orgId) return "no_org";
  if (input.tbaConfigured === false) return "tba";
  if (input.setupRequired) return "setup";
  return "ready";
}

/** Soft-UI next actions — short labels; role-aware; one primary when blocked. */
export function dashboardNextActions(input: {
  orgId?: string | null;
  shell: DashboardShellKind;
  hasScoutingSchemas?: boolean;
  hasAiProvider?: boolean;
  role?: string | null;
}): DashboardNextAction[] {
  const { orgId, shell } = input;
  if (shell === "loading") return [];

  const role = (input.role ?? "").toLowerCase();
  const isOwnerAdmin = role === "owner" || role === "admin";

  if (shell === "no_org") {
    // One short invite path — never a laundry list of accept/email/support rows.
    return [
      {
        id: "invite",
        label: "Open invite",
        detail: "Use the link sent to your email.",
        href: "/invite",
        primary: true,
      },
    ];
  }

  const actions: DashboardNextAction[] = [];

  if (shell === "tba") {
    actions.push({
      id: "tba",
      label: "Connect TBA",
      detail: "Needed for live match and rank widgets.",
      href: withOrgHref("/team/data", orgId),
      primary: true,
    });
  }

  if (shell === "setup") {
    actions.push({
      id: "event",
      label: "Set active event",
      detail: "Competition widgets need an event.",
      href: hubHref("/competition", "command", orgId),
      primary: true,
    });
  }

  if (shell === "ready") {
    if (input.hasScoutingSchemas === false) {
      actions.push({
        id: "scouting-forms",
        label: "Create scouting forms",
        detail: "Publish match and pit forms.",
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      });
    }
    if (input.hasAiProvider === false && isOwnerAdmin) {
      actions.push({
        id: "ai-provider",
        label: "Add AI keys",
        detail: "Optional — for Free / your-keys routing.",
        href: withOrgHref("/team/ai-keys", orgId),
        primary: actions.length === 0,
      });
    }
    return actions;
  }

  // Members with org never see invite-accept checklists.
  return actions;
}

/** Ordered setup checklist for the Home Soft-UI banner. */
export function dashboardSetupSteps(input: {
  orgId?: string | null;
  setupRequired?: boolean;
  tbaConfigured?: boolean | null;
  hasScoutingSchemas?: boolean;
  hasAiProvider?: boolean;
  role?: string | null;
}): DashboardSetupStep[] {
  const orgId = input.orgId ?? null;
  const hasOrg = Boolean(orgId);
  const role = (input.role ?? "").toLowerCase();
  const isOwnerAdmin = role === "owner" || role === "admin";
  const eventDone = hasOrg && !input.setupRequired;
  const tbaDone = input.tbaConfigured === true;
  const tbaCurrent = hasOrg && input.tbaConfigured === false;
  const scoutDone = input.hasScoutingSchemas === true;
  const aiDone = input.hasAiProvider === true;

  const steps: DashboardSetupStep[] = [
    {
      id: "workspace",
      label: hasOrg ? "Workspace" : "Join workspace",
      detail: hasOrg
        ? isOwnerAdmin
          ? "Team selected"
          : "You’re on a team"
        : "Open the invite sent to your email",
      href: hasOrg ? withOrgHref("/workspace", orgId) : "/invite",
      state: hasOrg ? "done" : "current",
    },
    {
      id: "event",
      label: "Select event",
      detail: "Set the active competition",
      href: hubHref("/competition", "command", orgId),
      state: !hasOrg ? "pending" : eventDone ? "done" : "current",
    },
    {
      id: "tba",
      label: "Connect TBA",
      detail: "Match and rank data",
      href: withOrgHref("/team/data", orgId),
      state: !hasOrg ? "pending" : tbaDone ? "done" : tbaCurrent ? "current" : "pending",
    },
    {
      id: "scout",
      label: "Scout forms",
      detail: "Match and pit forms",
      href: hubHref("/competition", "forms", orgId),
      state: !hasOrg || input.setupRequired ? "pending" : scoutDone ? "done" : "current",
    },
  ];

  if (isOwnerAdmin || !hasOrg) {
    steps.push({
      id: "ai",
      label: "AI keys",
      detail: "Optional provider keys",
      href: withOrgHref("/team/ai-keys", orgId),
      state: !hasOrg ? "pending" : aiDone ? "done" : "current",
    });
  }

  return steps;
}

export function dashboardSetupTitle(shell: DashboardShellKind): string {
  switch (shell) {
    case "no_org":
      return "Join your team";
    case "setup":
      return "Set an active event";
    case "tba":
      return "Connect TBA";
    case "loading":
      return "Loading…";
    default:
      return "Home";
  }
}

export function dashboardSetupBlurb(shell: DashboardShellKind): string {
  switch (shell) {
    case "no_org":
      return "Open the invite sent to your email.";
    case "setup":
      return "Pick the event this board should follow.";
    case "tba":
      return "Sync The Blue Alliance for live match data.";
    case "loading":
      return "Checking your workspace.";
    default:
      return "";
  }
}
