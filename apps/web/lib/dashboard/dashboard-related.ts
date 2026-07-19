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

/** Soft-UI next actions — honest when TBA / event / workspace missing; never DEMO metrics. */
export function dashboardNextActions(input: {
  orgId?: string | null;
  shell: DashboardShellKind;
  hasScoutingSchemas?: boolean;
  hasAiProvider?: boolean;
}): DashboardNextAction[] {
  const { orgId, shell } = input;
  if (shell === "loading") return [];

  if (shell === "no_org") {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Pick a real team membership — nothing is pre-seeded.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "invite",
        label: "Accept invite",
        detail: "Exact-email invites only — team numbers never open a workspace.",
        href: "/invite",
      },
      {
        id: "account",
        label: "Account",
        detail: "Profile and notification prefs while you wait for a membership.",
        href: "/account",
      },
    ];
  }

  const actions: DashboardNextAction[] = [];

  if (shell === "tba") {
    actions.push({
      id: "tba",
      label: "Connect TBA",
      detail: "Live match and rank widgets stay empty until The Blue Alliance is configured.",
      href: withOrgHref("/team/data", orgId),
      primary: true,
    });
  }

  if (shell === "setup") {
    actions.push({
      id: "event",
      label: "Select active event",
      detail: "Competition widgets wait for a real event context — never invent schedules.",
      href: hubHref("/competition", "command", orgId),
      primary: true,
    });
  }

  actions.push(
    {
      id: "competition",
      label: "Competition hub",
      detail: "Command, My Day, strategy, and scouting in one Soft-UI shell.",
      href: dashboardHubHref("competition", orgId),
      primary: shell === "ready",
    },
    {
      id: "team",
      label: "Team hub",
      detail: "Members, calendar, and ops — invite stays exact-email.",
      href: dashboardHubHref("team", orgId),
    },
    {
      id: "business",
      label: "Business hub",
      detail: "Sponsors, grants, and award evidence — no DEMO counts.",
      href: dashboardHubHref("business", orgId),
    },
    {
      id: "build",
      label: "Build hub",
      detail: "CAD, bring-up, and shop tools for the robot season.",
      href: dashboardHubHref("build", orgId),
    },
    {
      id: "ai",
      label: "AI hub",
      detail: "Metered chat and budgets — configure a provider before expecting usage.",
      href: dashboardHubHref("ai", orgId),
    },
  );

  if (input.hasScoutingSchemas === false) {
    actions.splice(1, 0, {
      id: "scouting-forms",
      label: "Create scouting forms",
      detail: "Starter match and pit forms stay blank until your team publishes them.",
      href: hubHref("/competition", "forms", orgId),
    });
  }

  if (input.hasAiProvider === false) {
    actions.push({
      id: "ai-provider",
      label: "Configure metered AI",
      detail: "BYO provider key for free-tier AI — usage stays honest.",
      href: hubHref("/ai", "budgets", orgId),
    });
  }

  return actions;
}

/** Ordered setup checklist for the Home Soft-UI banner. */
export function dashboardSetupSteps(input: {
  orgId?: string | null;
  setupRequired?: boolean;
  tbaConfigured?: boolean | null;
  hasScoutingSchemas?: boolean;
  hasAiProvider?: boolean;
}): DashboardSetupStep[] {
  const orgId = input.orgId ?? null;
  const hasOrg = Boolean(orgId);
  const eventDone = hasOrg && !input.setupRequired;
  const tbaDone = input.tbaConfigured === true;
  const tbaCurrent = hasOrg && input.tbaConfigured === false;
  const scoutDone = input.hasScoutingSchemas === true;
  const aiDone = input.hasAiProvider === true;

  return [
    {
      id: "workspace",
      label: "Join workspace",
      detail: "Accept a team invite or select your org",
      href: hasOrg ? withOrgHref("/workspace", orgId) : "/invite",
      state: hasOrg ? "done" : "current",
    },
    {
      id: "event",
      label: "Select event",
      detail: "Set the active competition context",
      href: hubHref("/competition", "command", orgId),
      state: !hasOrg ? "pending" : eventDone ? "done" : "current",
    },
    {
      id: "tba",
      label: "Sync TBA",
      detail: "Match and rank data from The Blue Alliance",
      href: withOrgHref("/team/data", orgId),
      state: !hasOrg ? "pending" : tbaDone ? "done" : tbaCurrent ? "current" : "pending",
    },
    {
      id: "scout",
      label: "Scout",
      detail: "Starter match and pit forms for the season",
      href: hubHref("/competition", "forms", orgId),
      state: !hasOrg || input.setupRequired ? "pending" : scoutDone ? "done" : "current",
    },
    {
      id: "ai",
      label: "Metered AI",
      detail: "BYO provider key for free-tier AI features",
      href: hubHref("/ai", "budgets", orgId),
      state: !hasOrg ? "pending" : aiDone ? "done" : "current",
    },
  ];
}

export function dashboardSetupTitle(shell: DashboardShellKind): string {
  switch (shell) {
    case "no_org":
      return "Join your team workspace";
    case "setup":
      return "Select an active event";
    case "tba":
      return "Connect TBA for live data";
    case "loading":
      return "Loading your workspace…";
    default:
      return "Home is ready";
  }
}
