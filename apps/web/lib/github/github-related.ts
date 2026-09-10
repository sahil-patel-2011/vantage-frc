import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for GitHub robot-code context (never DEMO repos). */
export const GITHUB_RELATED_LINKS = [
  { id: "pair", label: "Pair VS Code", kind: "path" as const, path: "/editor/pair" },
  { id: "code", label: "Code Coach", kind: "build" as const, tab: "code" },
  {
    id: "connections",
    label: "Account Connections",
    kind: "account" as const,
    path: "/connectors",
  },
  { id: "chat", label: "AI chat", kind: "ai" as const, tab: "chat" },
  { id: "admin", label: "Team admin", kind: "path" as const, path: "/team/admin" },
] as const;

export type GitHubRelatedId = (typeof GITHUB_RELATED_LINKS)[number]["id"];

export type GitHubRelatedLink = {
  id: GitHubRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Pair VS Code / Code Coach / Account Connections. */
export const GITHUB_RELATED_INCLUDE: GitHubRelatedId[] = ["pair", "code", "connections"];

/**
 * Canonical Soft-UI deep link to the GitHub PAT / OAuth panel.
 * Lives on Team admin — never `/team` hub (no `#github-connection` there).
 */
export function githubConnectionHref(orgId?: string | null): string {
  return withOrgHref("/team/admin", orgId) + "#github-connection";
}

/**
 * Soft-UI cross-links from GitHub context → Pair VS Code / Code Coach / Account Connections.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function githubRelatedLinks(
  orgId?: string | null,
  options?: { active?: GitHubRelatedId; include?: GitHubRelatedId[] },
): GitHubRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return GITHUB_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    if (link.kind === "account") {
      return { id: link.id, label: link.label, href: link.path };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type GitHubShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type GitHubNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type GitHubEmptyCopy = {
  kind: GitHubShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO repos. */
export type GitHubSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function githubSetupSteps(orgId?: string | null): GitHubSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open GitHub context.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "pat",
      label: "Save an encrypted PAT",
      detail: "Fine-grained or classic token with Contents: Read.",
      href: githubConnectionHref(orgId),
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Local pattern review stays blank until you paste real robot source.",
      href: hubHref("/build", "code", orgId),
    },
    {
      id: "pair",
      label: "Pair VS Code",
      detail: "Approve a real editor device after linking.",
      href: withOrgHref("/editor/pair", orgId),
    },
  ];
}

/** Real repo counts only — never invent DEMO totals. */
export function formatGitHubRepoMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed repo tiles when nothing is linked. */
export function shouldShowGitHubSummaryTiles(input: {
  connected: boolean;
  repoCount: number;
}): boolean {
  return input.connected && input.repoCount > 0;
}

/** True when the team has no GitHub link — Soft-UI empty. */
export function isGitHubBoardEmpty(input: { connected: boolean }): boolean {
  return !input.connected;
}

/** Classify GitHub Soft-UI shell — never invents DEMO repos. */
export function classifyGitHubShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  hasOrgs?: boolean;
  orgId?: string | null;
  connected?: boolean;
}): GitHubShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.hasOrgs || !input.orgId) return "setup";
  if (isGitHubBoardEmpty({ connected: Boolean(input.connected) })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO repos. */
export function githubShellCopy(kind: GitHubShellKind): GitHubEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading GitHub context…",
        description:
          "Checking which team you are on and real GitHub links.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load GitHub context",
        description:
          "A network or server issue blocked the connection panel. Retry, or open Pair VS Code / Code Coach / Account Connections while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Join or pick a team before linking OAuth or a PAT.",
      };
    case "empty":
      return {
        kind,
        badge: "Not connected",
        title: "Link GitHub for this team",
        description:
          "Repo context stays blank until an owner/admin connects OAuth or saves an encrypted PAT. Cross-check Pair VS Code, Code Coach, and Account Connections.",
      };
    default:
      return {
        kind: "ready",
        title: "GitHub robot-code context",
        description:
          "Only repos returned for the linked account appear here.",
      };
  }
}

/**
 * Soft-UI next actions for GitHub empty/setup shells.
 * Points at Pair VS Code / Code Coach / Account Connections — never invents DEMO repos.
 */
export function githubNextActions(input: {
  orgId?: string | null;
  shell: GitHubShellKind;
  connected?: boolean;
  hasDefaultRepo?: boolean;
  oauthSetupRequired?: boolean;
  repoCount?: number;
}): GitHubNextAction[] {
  const orgId = input.orgId ?? null;
  const connected = Boolean(input.connected);
  const repoCount = input.repoCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before linking a PAT or OAuth.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "code",
          label: "Open Code Coach",
          detail: "Local pattern review stays blank until you paste source.",
          href: hubHref("/build", "code", null),
        },
        {
          id: "pair",
          label: "Pair VS Code",
          detail: "Editor pairing needs a team too.",
          href: withOrgHref("/editor/pair", null),
        },
        {
          id: "connections",
          label: "Account Connections",
          detail: "Honest connector status for TBA, Onshape, Discord, and GitHub.",
          href: "/connectors",
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so GitHub context can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Local pattern review stays blank until you paste real robot source.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "pair",
        label: "Pair VS Code",
        detail: "Approve a real editor after linking.",
        href: withOrgHref("/editor/pair", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "See GitHub among other workspace connectors — Connected only from real rows.",
        href: "/connectors",
      },
    ];
  }

  if (input.shell === "empty" || !connected) {
    return [
      {
        id: "connect",
        label: input.oauthSetupRequired ? "Encrypt and save a PAT" : "Connect GitHub",
        detail: input.oauthSetupRequired
          ? "Signing in with GitHub is optional here — saving an encrypted access token works today."
          : "Authorize OAuth or paste a fine-grained PAT with Contents: Read below.",
        href: "#github-connection",
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Review pasted source locally without a linked repo.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "pair",
        label: "Pair VS Code",
        detail: "Approve an editor device independently of GitHub context.",
        href: withOrgHref("/editor/pair", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "GitHub stays Not connected on Account until a real link exists.",
        href: "/connectors",
      },
    ];
  }

  if (!input.hasDefaultRepo) {
    return [
      {
        id: "default-repo",
        label: repoCount > 0 ? "Choose default robot-code repo" : "Waiting for real repos",
        detail:
          repoCount > 0
            ? `${repoCount} real repositor${repoCount === 1 ? "y" : "ies"} from the linked account — pick one.`
            : "No repositories returned for this account yet — the picker stays blank.",
        href: "#github-default-repo",
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Local review still works with pasted source while you pick a default repo.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "pair",
        label: "Pair VS Code",
        detail: "Approve editors that can share opt-in context into AI later.",
        href: withOrgHref("/editor/pair", orgId),
      },
      {
        id: "connections",
        label: "Account Connections",
        detail: "Confirm GitHub shows Connected from the real workspace row.",
        href: "/connectors",
      },
    ];
  }

  return [
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Hydrate optional file context from your default repo — still local rules only.",
      href: hubHref("/build", "code", orgId),
      primary: true,
    },
    {
      id: "pair",
      label: "Pair VS Code",
      detail: "Approve editors that can share opt-in context into Team Assistant.",
      href: withOrgHref("/editor/pair", orgId),
    },
    {
      id: "connections",
      label: "Account Connections",
      detail: "GitHub Connected reflects this team link.",
      href: "/connectors",
    },
    {
      id: "chat",
      label: "Open AI chat",
      detail: "Size-capped snippets from the default repo can ground assistant answers when requested.",
      href: hubHref("/ai", "chat", orgId),
    },
  ];
}
