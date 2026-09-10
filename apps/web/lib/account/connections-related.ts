import { withOrgHref } from "../nav/product-nav";
import { githubConnectionHref } from "../github/github-related";

/** Soft-UI connector ids on Account → Connections (never DEMO connected). */
export type ConnectionConnectorId = "google" | "tba" | "onshape" | "discord" | "github" | "slack";

/** Honest Soft-UI status — `connected` only when a real row/env proof exists. */
export type ConnectionConnectorStatus = "connected" | "available" | "empty" | "setup_required";

export type ConnectionConnectorView = {
  id: ConnectionConnectorId;
  label: string;
  status: ConnectionConnectorStatus;
  detail: string;
  href: string;
  cta: string;
};

/** Soft-UI related surfaces from Connections — Account / CAD / Discord first. */
export const CONNECTIONS_RELATED_LINKS = [
  { id: "account", label: "Account", kind: "path" as const, path: "/account" },
  { id: "cad", label: "CAD Connections", kind: "path" as const, path: "/cad/connections" },
  { id: "discord", label: "Discord", kind: "path" as const, path: "/team/discord" },
  { id: "slack", label: "Slack", kind: "path" as const, path: "/team/slack" },
  { id: "tba", label: "Team Data", kind: "path" as const, path: "/team/data" },
  { id: "github", label: "Team admin · GitHub", kind: "path" as const, path: "/team/admin", hash: "#github-connection" },
  { id: "workspace", label: "Workspace", kind: "path" as const, path: "/workspace" },
] as const;

export type ConnectionsRelatedId = (typeof CONNECTIONS_RELATED_LINKS)[number]["id"];

export type ConnectionsRelatedLink = {
  id: ConnectionsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Account · CAD · Discord. */
export const CONNECTIONS_RELATED_INCLUDE: ConnectionsRelatedId[] = ["account", "cad", "discord", "slack"];

/** Cross-links for Connections Soft-UI (never DEMO bridge/OAuth status). */
export function connectionsRelatedLinks(
  orgId?: string | null,
  options?: { active?: ConnectionsRelatedId; include?: ConnectionsRelatedId[] },
): ConnectionsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CONNECTIONS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.id === "account") {
      return { id: link.id, label: link.label, href: "/account" };
    }
    if (link.id === "workspace") {
      return { id: link.id, label: link.label, href: "/workspace" };
    }
    const hash = "hash" in link ? link.hash : "";
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) + hash };
  });
}

export type ConnectionsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ConnectionsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ConnectionsEmptyCopy = {
  badge: string;
  badgeTone: "setup" | "good";
  title: string;
  description: string;
};

/** Soft-UI badge label for a connector — never invents DEMO Connected. */
export function connectionBadgeLabel(status: ConnectionConnectorStatus): string {
  if (status === "connected") return "Connected";
  if (status === "available") return "Ready";
  if (status === "empty") return "Not connected";
  return "Setup required";
}

/** Soft-UI badge tone — Connected is the only "good" state. */
export function connectionBadgeTone(status: ConnectionConnectorStatus): "good" | "setup" {
  return status === "connected" ? "good" : "setup";
}

/**
 * Classify Connections Soft-UI shell from real connector statuses.
 * Never invents DEMO connected counts.
 */
export function classifyConnectionsShell(input: {
  orgId?: string | null;
  loading?: boolean;
  fetchFailed?: boolean;
  connectors?: Array<{ status: ConnectionConnectorStatus }>;
}): ConnectionsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  const connectors = input.connectors ?? [];
  const hasConnected = connectors.some((c) => c.status === "connected");
  const hasReady = connectors.some(
    (c) => c.status === "available" || c.status === "connected",
  );
  if (hasConnected || hasReady) return "ready";
  return "empty";
}

/** Soft-UI empty / setup copy for Connections — never DEMO linked accounts. */
export function connectionsEmptyCopy(shell: ConnectionsShellKind): ConnectionsEmptyCopy {
  if (shell === "setup") {
    return {
      badge: "Setup required",
      badgeTone: "setup",
      title: "Connectors need a workspace",
      description:
        "Google sign-in is personal to this deployment. TBA, Onshape, Discord, and GitHub are saved per active team — nothing shows Connected until a real link exists.",
    };
  }
  if (shell === "empty") {
    return {
      badge: "Not connected",
      badgeTone: "setup",
      title: "No team connectors linked yet",
      description:
        "Statuses stay blank until you configure TBA, authorize Onshape, add Discord, or link GitHub.",
    };
  }
  if (shell === "error") {
    return {
      badge: "Unavailable",
      badgeTone: "setup",
      title: "Couldn’t load connections",
      description: "A network or server issue prevented loading connector status. Retry, or open Support if this keeps failing.",
    };
  }
  if (shell === "loading") {
    return {
      badge: "Loading",
      badgeTone: "setup",
      title: "Loading connections",
      description: "Checking deployment setup and workspace links — Connected only appears for real rows.",
    };
  }
  return {
    badge: "Connections",
    badgeTone: "good",
    title: "Workspace connectors",
    description: "Honest setup and link status for TBA, Onshape, Google, Discord, and GitHub.",
  };
}

/**
 * Soft-UI next actions for Connections empty / setup.
 * Points at Account / CAD / Discord — never DEMO OAuth success.
 */
export function connectionsNextActions(input: {
  orgId?: string | null;
  googleReady?: boolean;
  tbaReady?: boolean;
  onshapeStatus?: ConnectionConnectorStatus;
  discordStatus?: ConnectionConnectorStatus;
  githubStatus?: ConnectionConnectorStatus;
  slackStatus?: ConnectionConnectorStatus;
}): ConnectionsNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select a workspace",
        detail: "Pick a team before linking.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "account",
        label: "Account profile",
        detail: "Display name and notification prefs still save for this login without a workspace.",
        href: "/account?tab=profile",
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Ask for team access if you expected membership and don’t see a workspace.",
        href: "/support",
      },
    ];
  }

  const actions: ConnectionsNextAction[] = [];

  if (input.tbaReady === false) {
    actions.push({
      id: "tba",
      label: "Configure TBA",
      detail: "Match sync stays quiet until a TBA key or saved rankings exist.",
      href: withOrgHref("/team/data", orgId),
      primary: true,
    });
  }

  if (input.onshapeStatus === "setup_required" || input.onshapeStatus === "empty") {
    actions.push({
      id: "onshape",
      label: input.onshapeStatus === "setup_required" ? "Onshape OAuth setup" : "Connect Onshape",
      detail:
        input.onshapeStatus === "setup_required"
          ? "Setup required — an admin must set ONSHAPE_OAUTH_* before hosted CAD can authorize."
          : "OAuth client is ready — authorize in CAD Connections. Connected only after a real OAuth row.",
      href: withOrgHref("/cad/connections", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.discordStatus === "setup_required" || input.discordStatus === "empty") {
    actions.push({
      id: "discord",
      label: "Link Discord",
      detail: "Add a channel webhook (or bot + channel id) on the Discord settings page.",
      href: withOrgHref("/team/discord", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.slackStatus === "setup_required" || input.slackStatus === "empty") {
    actions.push({
      id: "slack",
      label: "Link Slack",
      detail: "Paste a channel webhook so Vantage team chat and Slack stay in sync.",
      href: withOrgHref("/team/slack", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.githubStatus === "empty" || input.githubStatus === "setup_required") {
    actions.push({
      id: "github",
      label: "Link GitHub",
      detail: "Owners/admins connect OAuth or save an encrypted PAT in Team admin — AI context stays empty until linked.",
      href: githubConnectionHref(orgId),
      primary: actions.length === 0,
    });
  }

  if (input.googleReady === false) {
    actions.push({
      id: "google",
      label: "Google sign-in setup",
      detail: "This deployment is missing Google OAuth env — use email OTP until an admin configures it.",
      href: "/connectors",
    });
  }

  actions.push(
    {
      id: "cad",
      label: "Open CAD Connections",
      detail: "Onshape OAuth and Fusion desktop relay live here — Fusion stays local, never hosted.",
      href: withOrgHref("/cad/connections", orgId),
      primary: actions.length === 0,
    },
    {
      id: "discord-page",
      label: "Open Discord settings",
      detail: "Guild / webhook bridge for announcements and object-linked chat posts.",
      href: withOrgHref("/team/discord", orgId),
    },
    {
      id: "account",
      label: "Back to Account",
      detail: "Profile, appearance, and notification prefs for this login.",
      href: "/account?tab=profile",
    },
  );

  return actions.slice(0, 5);
}

/**
 * Build Soft-UI connector cards from API integration payloads.
 * `connected` is only emitted when callers pass real proof — never DEMO.
 */
export function buildConnectionConnectors(input: {
  orgId?: string | null;
  google?: { status: "available" | "setup_required"; detail: string };
  tba?: { status: "available" | "setup_required"; detail: string };
  onshape?: {
    status: ConnectionConnectorStatus;
    detail: string;
  };
  discord?: {
    status: ConnectionConnectorStatus;
    detail: string;
  };
  github?: {
    status: ConnectionConnectorStatus;
    detail: string;
  };
  slack?: {
    status: ConnectionConnectorStatus;
    detail: string;
  };
}): ConnectionConnectorView[] {
  const orgId = input.orgId ?? null;

  const googleStatus: ConnectionConnectorStatus =
    input.google?.status === "available" ? "available" : "setup_required";
  const tbaStatus: ConnectionConnectorStatus =
    input.tba?.status === "available" ? "available" : "setup_required";

  return [
    {
      id: "google",
      label: "Google",
      status: googleStatus,
      detail: input.google?.detail ?? "Checking Google configuration…",
      href: "/signin",
      cta: "Open sign-in",
    },
    {
      id: "tba",
      label: "The Blue Alliance",
      status: tbaStatus,
      detail: input.tba?.detail ?? "Checking TBA configuration…",
      href: orgId ? withOrgHref("/team/data", orgId) : "/workspace",
      cta: orgId ? "Open TBA connectors" : "Select workspace",
    },
    {
      id: "onshape",
      label: "Onshape",
      status: input.onshape?.status ?? (orgId ? "empty" : "setup_required"),
      detail: input.onshape?.detail ?? "Checking Onshape OAuth…",
      href: orgId ? withOrgHref("/cad/connections", orgId) : "/workspace",
      cta: orgId ? "Open CAD Connections" : "Select workspace",
    },
    {
      id: "discord",
      label: "Discord",
      status: input.discord?.status ?? (orgId ? "empty" : "setup_required"),
      detail: input.discord?.detail ?? "Checking Discord bridge…",
      href: orgId ? withOrgHref("/team/discord", orgId) : "/workspace",
      cta: orgId ? "Open Discord" : "Select workspace",
    },
    {
      id: "slack",
      label: "Slack",
      status: input.slack?.status ?? (orgId ? "empty" : "setup_required"),
      detail: input.slack?.detail ?? "Checking Slack bridge…",
      href: orgId ? withOrgHref("/team/slack", orgId) : "/workspace",
      cta: orgId ? "Open Slack" : "Select workspace",
    },
    {
      id: "github",
      label: "GitHub",
      status: input.github?.status ?? (orgId ? "empty" : "setup_required"),
      detail: input.github?.detail ?? "Checking GitHub link…",
      href: orgId ? githubConnectionHref(orgId) : "/workspace",
      cta: orgId ? "Open Team admin" : "Select workspace",
    },
  ];
}
