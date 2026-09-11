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
        badge: "Needs setup",
        title: "Ask AI needs a key",
        description:
          "A mentor or owner adds a platform or your own key under Team Admin. Chat stays empty until then.",
      };
    case "empty":
      return {
        kind,
        badge: "Start here",
        title: "Pick or create a channel",
        description:
          "Private chats stay yours. Team-shared channels are visible to teammates. Tools run when you ask about a team or a match.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Chat",
        description: "A network or server issue blocked channels. Retry, or check Chat limits if Chat is paused.",
      };
    case "ready":
      return {
        kind,
        title: "Chat",
        description:
          "Ask about teams, matchups, and scout evidence. Tools cite what this team has actually recorded.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Next actions for ready Chat. Empty / setup / error / auth keep them off —
 * those shells keep one EmptyState primary (or New private chat on empty).
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
        detail: "Chat channels and memory are saved per team. Choose your team first.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);

  if (input.shell !== "ready") {
    return [];
  }

  return [
    {
      id: "budgets",
      label: "Open Chat limits",
      detail: "Spend and token limits live next to Chat. Pause Chat if the team is at the cap.",
      href: budgetsHref,
      primary: true,
    },
    {
      id: "memory",
      label: "Open Memory",
      detail: "Admins choose what the team remembers. Private notes stay yours.",
      href: memoryHref,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ask about matchups from this team's scout notes.",
      href: strategyHref,
    },
  ];
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
    body: "Every message is visible to teammates before send. Promote useful replies into Memory only when you choose.",
  },
] as const;
