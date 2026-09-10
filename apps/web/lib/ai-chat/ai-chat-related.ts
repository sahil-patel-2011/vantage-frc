import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI shell kinds for `/ai?tab=chat` — never DEMO replies or invented tool rows. */
export type AiChatShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "auth_required"
  | "error";

export type AiChatRelatedId =
  | "budgets"
  | "memory"
  | "strategy"
  | "usage"
  | "scouting"
  | "knowledge"
  | "governance"
  | "code";

export type AiChatRelatedLink = {
  id: AiChatRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from AI Chat → Budgets · Memory · Strategy.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function aiChatRelatedLinks(
  orgId?: string | null,
  options?: { include?: AiChatRelatedId[] },
): AiChatRelatedLink[] {
  if (!orgId) return [];
  const include = options?.include ? new Set(options.include) : null;
  const all: AiChatRelatedLink[] = [
    { id: "budgets", label: "Budgets", href: hubHref("/ai", "budgets", orgId) },
    { id: "memory", label: "Memory", href: hubHref("/ai", "memory", orgId) },
    { id: "strategy", label: "Strategy", href: hubHref("/competition", "strategy", orgId) },
    { id: "usage", label: "AI usage", href: hubHref("/ai", "usage", orgId) },
    { id: "scouting", label: "Scouting", href: hubHref("/competition", "scouting", orgId) },
    { id: "knowledge", label: "Knowledge", href: withOrgHref("/team?tab=knowledge", orgId) },
    { id: "governance", label: "Governance", href: hubHref("/ai", "governance", orgId) },
    { id: "code", label: "Code Coach", href: hubHref("/ai", "code", orgId) },
  ];
  return all.filter((link) => !include || include.has(link.id));
}

/** Primary Soft-UI strip: Budgets · Memory · Strategy. */
export const AI_CHAT_RELATED_INCLUDE: AiChatRelatedId[] = ["budgets", "memory", "strategy"];

export type AiChatNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AiChatEmptyCopy = {
  kind: AiChatShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Classify Soft-UI shell from agent load / provider setup outcome. */
export function classifyAiChatShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  providerSetup: boolean;
  threadCount: number;
  hasActiveThread: boolean;
}): AiChatShellKind {
  if (input.loading) return "loading";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    return "error";
  }
  if (status != null && status >= 500) return "error";
  if (input.providerSetup) return "setup";
  if (input.hasActiveThread) return "ready";
  if (input.threadCount === 0) return "empty";
  return "empty";
}

/** Soft-UI empty / setup copy — never DEMO replies or invented tool rows. */
export function aiChatShellCopy(kind: AiChatShellKind): AiChatEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading assistant…",
        description: "Checking your team's channels and memory settings for this team.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to use Chat",
        description: "Sign in, then reopen Chat from the AI hub.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "AI provider not configured",
        description:
          "Configure a platform or BYO key before messaging. Chat stays empty until a key is set; rankings and scouting stay empty until those exist.",
      };
    case "empty":
      return {
        kind,
        badge: "Start here",
        title: "Pick or create a channel",
        description:
          "Private chats stay yours. Team-shared channels are visible to members. Tools only run when authorized.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Chat",
        description: "A network or server issue blocked channels. Retry, or check Budgets if AI is cut off.",
      };
    default:
      return {
        kind: "ready",
        title: "FRC Assistant",
        description:
          "Ask about teams, matchups, and scout evidence. Authorized tools cite real rows only.",
      };
  }
}

/**
 * Soft-UI next actions for empty / setup Chat.
 * Points at Budgets · Memory · Strategy — never invents DEMO replies.
 */
export function aiChatNextActions(input: {
  orgId?: string | null;
  shell: AiChatShellKind;
}): AiChatNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Chat channels and memory are saved per org — pick a team first.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Confirm membership, then return from the AI hub.",
        href: withOrgHref("/account", null),
      },
    ];
  }

  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const adminHref = withOrgHref("/team/admin", orgId);

  if (input.shell === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Closed membership — Google or email OTP, then reopen AI · Chat.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.shell === "setup") {
    return [
      {
        id: "admin",
        label: "Open Team Admin",
        detail: "Owners/admins add a platform or BYO provider key for metered Chat.",
        href: adminHref,
        primary: true,
      },
      {
        id: "budgets",
        label: "Open Budgets",
        detail: "Hard spend/token caps and prompt caching live next to Chat.",
        href: budgetsHref,
      },
      {
        id: "memory",
        label: "Open Memory",
        detail: "Team injection is separate from provider keys — optional after setup.",
        href: memoryHref,
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "budgets",
        label: "Check Chat limits",
        detail: "Pause Chat or a spend limit can block the assistant before a channel loads.",
        href: budgetsHref,
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Match prep without Chat — real scout and TBA rows only.",
        href: strategyHref,
      },
    ];
  }

  const actions: AiChatNextAction[] = [];

  if (input.shell === "empty") {
    actions.push({
      id: "new-private",
      label: "Start a private chat",
      detail: "Create a private channel in the sidebar.",
      href: "#ch-channels",
      primary: true,
    });
  }

  actions.push(
    {
      id: "budgets",
      label: "Open Budgets",
      detail: "Metered Chat enforces org spend/token caps — UsageCutoffBanner deep-links here.",
      href: budgetsHref,
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "memory",
      label: "Open Memory",
      detail: "Admins opt in to team-shared injection; private prefs stay in Chat context.",
      href: memoryHref,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground match prep in real scout/TBA rows the assistant can cite.",
      href: strategyHref,
    },
  );

  return actions;
}

/** Private vs team-shared clarity for Soft-UI Chat. */
export const AI_CHAT_SCOPE_CARDS = [
  {
    id: "private" as const,
    title: "Private channel",
    body: "Only you see the thread. Preferences you save stay private and are never auto-promoted into team memory.",
  },
  {
    id: "team" as const,
    title: "Team-shared channel",
    body: "Every message is visible to org members before send. Promote useful replies into Memory only when you choose.",
  },
] as const;
