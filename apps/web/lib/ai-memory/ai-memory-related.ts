import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI shell kinds for `/ai?tab=memory` — never DEMO memories. */
export type AiMemoryShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "forbidden"
  | "auth_required"
  | "error";

export type AiMemoryRelatedId =
  | "chat"
  | "budgets"
  | "usage"
  | "governance"
  | "knowledge"
  | "runs"
  | "prompt-caching";

export type AiMemoryRelatedLink = {
  id: AiMemoryRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from AI Memory → Chat / Budgets first.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function aiMemoryRelatedLinks(
  orgId?: string | null,
  options?: { active?: AiMemoryRelatedId; include?: AiMemoryRelatedId[] },
): AiMemoryRelatedLink[] {
  if (!orgId) return [];
  const include = options?.include ? new Set(options.include) : null;
  const all: AiMemoryRelatedLink[] = [
    { id: "chat", label: "Chat", href: hubHref("/ai", "chat", orgId) },
    { id: "budgets", label: "Budgets", href: hubHref("/ai", "budgets", orgId) },
    {
      id: "prompt-caching",
      label: "Prompt caching",
      href: `${hubHref("/ai", "budgets", orgId)}#prompt-caching`,
    },
    { id: "usage", label: "AI usage", href: withOrgHref("/team/usage", orgId) },
    { id: "runs", label: "AI runs", href: withOrgHref("/team/ai-runs", orgId) },
    { id: "governance", label: "Governance", href: hubHref("/ai", "governance", orgId) },
    { id: "knowledge", label: "Knowledge", href: withOrgHref("/team?tab=knowledge", orgId) },
  ];
  return all.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  });
}

/** Primary Soft-UI strip: Chat · Budgets (plus prompt caching / usage). */
export const AI_MEMORY_RELATED_INCLUDE: AiMemoryRelatedId[] = [
  "chat",
  "budgets",
  "prompt-caching",
  "usage",
];

export type AiMemoryNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AiMemoryEmptyCopy = {
  kind: AiMemoryShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real count lines only — never invent DEMO memory totals. */
export function formatAiMemoryMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Soft-UI shell from team-memory fetch outcome. */
export function classifyAiMemoryShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  enabled: boolean;
  activeCount: number;
}): AiMemoryShellKind {
  if (input.loading) return "loading";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/admin|administrator|forbidden|permission|access required/i.test(message)) return "forbidden";
    return "error";
  }
  if (status != null && status >= 500) return "error";
  if (!input.enabled && input.activeCount === 0) return "empty";
  if (input.enabled && input.activeCount === 0) return "setup";
  return "ready";
}

/** Soft-UI empty / setup / forbidden copy — never DEMO memories. */
export function aiMemoryShellCopy(kind: AiMemoryShellKind): AiMemoryEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading team memory…",
        description: "Checking your team's memory settings for this team.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to manage AI memory",
        description: "Sign in, then reopen Memory from Ask AI.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Admins only",
        title: "Team memory policy needs an admin",
        description:
          "Owners and admins turn on shared team memory. Your private Chat memories stay yours until you promote them.",
      };
    case "empty":
      return {
        kind,
        badge: "Empty",
        title: "No team memory yet",
        description:
          "Shared team memory stays empty until an admin turns it on and someone promotes a real Chat reply.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Team memory is on — nothing shared yet",
        description:
          "Sharing is enabled, but there are no active team memories. Promote useful private Chat replies, or leave the list empty.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load team memory",
        description: "A network or server issue blocked the team memory settings. Retry, or check Chat limits if Chat is cut off.",
      };
    case "ready":
      return {
        kind,
        title: "Team memory policy",
        description:
          "Admins control whether shared memories show up in Chat answers, how much they may use, and how long they live.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Soft-UI next actions for empty / setup / forbidden Memory.
 * Points at Chat + Budgets — never invents DEMO memories.
 */
export function aiMemoryNextActions(input: {
  orgId?: string | null;
  shell: AiMemoryShellKind;
  enabled?: boolean;
  activeCount?: number;
}): AiMemoryNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Team memory settings are saved per team.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const actions: AiMemoryNextAction[] = [];

  if (input.shell === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Closed membership — Google or email OTP, then reopen AI · Memory.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.shell === "forbidden") {
    return [
      {
        id: "chat-private",
        label: "Manage private memory in Chat",
        detail: "Add preferences in the Chat context panel. Private memory stays yours until you promote it.",
        href: chatHref,
        primary: true,
      },
    ];
  }

  if (input.shell === "empty" || (!input.enabled && (input.activeCount ?? 0) === 0)) {
    return [
      {
        id: "enable",
        label: "Turn on team memory",
        detail: "Opt in below so promoted memories can help Chat answers for the whole team.",
        href: "#team-memory-policy",
        primary: true,
      },
    ];
  }

  if (input.shell === "setup" || ((input.activeCount ?? 0) === 0 && input.enabled)) {
    return [
      {
        id: "promote",
        label: "Promote from Chat",
        detail: "Open a private Chat reply and use Promote to team memory — only real messages are stored.",
        href: chatHref,
        primary: true,
      },
    ];
  }

  actions.push(
    {
      id: "chat",
      label: "Open Chat",
      detail: "Private vs team-shared channels and per-user memory live on the assistant.",
      href: chatHref,
      primary: true,
    },
    {
      id: "budgets",
      label: "Open Chat limits",
      detail: "Spend limits are separate from how much team memory Chat may use.",
      href: budgetsHref,
    },
  );

  return actions;
}

/** Private vs team-shared clarity lines for Soft-UI Memory. */
export const AI_MEMORY_SCOPE_CARDS = [
  {
    id: "private" as const,
    title: "Private (you)",
    body: "Preferences and facts you save in Chat. Used only for you, and not added to team memory unless you promote them.",
  },
  {
    id: "team" as const,
    title: "Team-shared",
    body: "Only messages an author explicitly promotes. Admins must turn this on before any shared memory is used in Chat.",
  },
] as const;
