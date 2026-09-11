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
  const scoutDone = input.hasScoutingSchemas === true;
  const aiDone = input.hasAiProvider === true;

  // Exactly one current gate, matching the first-run banner. Optional scout/AI
  // steps stay pending until done — never painted as "you are here".
  let currentId = "";
  if (!hasOrg) currentId = "workspace";
  else if (input.tbaConfigured === false) currentId = "tba";
  else if (input.setupRequired) currentId = "event";

  const stateOf = (id: string, done: boolean): DashboardSetupStep["state"] => {
    if (done) return "done";
    if (id === currentId) return "current";
    return "pending";
  };

  const steps: DashboardSetupStep[] = [
    {
      id: "workspace",
      label: hasOrg ? "Your team" : "Choose your team",
      detail: hasOrg
        ? isOwnerAdmin
          ? "Team selected"
          : "You’re on a team"
        : "Open the invite sent to your email",
      href: hasOrg ? withOrgHref("/workspace", orgId) : "/invite",
      state: stateOf("workspace", hasOrg),
    },
    {
      id: "event",
      label: "Set active event",
      detail: "Set the active competition",
      href: hubHref("/competition", "command", orgId),
      state: stateOf("event", eventDone),
    },
    {
      id: "tba",
      label: "Connect TBA",
      detail: "Match and rank data",
      href: withOrgHref("/team/data", orgId),
      state: stateOf("tba", tbaDone),
    },
    {
      id: "scout",
      label: "Scout forms",
      detail: "Match and pit forms",
      href: hubHref("/competition", "forms", orgId),
      state: stateOf("scout", scoutDone),
    },
  ];

  if (isOwnerAdmin || !hasOrg) {
    steps.push({
      id: "ai",
      label: "AI keys",
      detail: "Optional provider keys",
      href: withOrgHref("/team/ai-keys", orgId),
      state: stateOf("ai", aiDone),
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
    case "ready":
      return "Home";
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

export function dashboardSetupBlurb(shell: DashboardShellKind): string {
  switch (shell) {
    case "no_org":
      return "Open the invite sent to your email.";
    case "setup":
      return "Set the event this board should follow.";
    case "tba":
      return "Sync The Blue Alliance for live match data.";
    case "loading":
      return "Checking your team.";
    case "ready":
      return "";
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

/**
 * Invite/TBA CTAs wait until /api/me resolves. A hung session must still paint
 * the First-run region (Loading… / Checking your team) so Home is never blank.
 */
export function dashboardSetupBannerPrimary(
  shell: DashboardShellKind,
  nextActions: DashboardNextAction[],
  setupSteps: DashboardSetupStep[],
): DashboardNextAction | DashboardSetupStep | null {
  switch (shell) {
    case "loading":
    case "ready":
      return null;
    case "no_org":
    case "setup":
    case "tba":
      return (
        nextActions.find((action) => action.primary) ??
        setupSteps.find((step) => step.state === "current") ??
        null
      );
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

/** First-run banner CTA — student words, not the internal step id. */
export function dashboardSetupBannerLabel(primary: DashboardNextAction | DashboardSetupStep): string {
  switch (primary.id) {
    case "invite":
      return "Open invite";
    case "tba":
      return "Connect TBA";
    case "event":
      return "Set active event";
    default:
      return primary.label;
  }
}
