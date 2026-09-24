import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI shell kinds for `/ai?tab=budgets` and `/ai?tab=usage` — never DEMO spend. */
export type AiBudgetsShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "forbidden"
  | "auth_required"
  | "error";

export type AiBudgetsRelatedId =
  | "chat"
  | "usage"
  | "pricing"
  | "account"
  | "governance"
  | "memory"
  | "admin";

export type AiBudgetsRelatedLink = {
  id: AiBudgetsRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from AI Budgets / Usage → Chat · Pricing · Account.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function aiBudgetsRelatedLinks(
  orgId?: string | null,
  options?: { active?: AiBudgetsRelatedId | "budgets"; include?: AiBudgetsRelatedId[] },
): AiBudgetsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  const all: AiBudgetsRelatedLink[] = [
    { id: "chat", label: "Chat", href: hubHref("/ai", "chat", orgId) },
    { id: "usage", label: "AI usage", href: hubHref("/ai", "usage", orgId) },
    { id: "pricing", label: "Pricing", href: withOrgHref("/pricing", orgId) },
    { id: "account", label: "Account", href: withOrgHref("/account", orgId) },
    { id: "governance", label: "Governance", href: hubHref("/ai", "governance", orgId) },
    { id: "memory", label: "Memory", href: hubHref("/ai", "memory", orgId) },
    { id: "admin", label: "Team admin", href: withOrgHref("/team/admin", orgId) },
  ];
  return all.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  });
}

/** Primary Soft-UI strip: Chat · Pricing · Account (+ Usage when on Budgets). */
export const AI_BUDGETS_RELATED_INCLUDE: AiBudgetsRelatedId[] = [
  "chat",
  "usage",
  "pricing",
  "account",
];

/** Usage page strip emphasizes Budgets via hub — Chat · Pricing · Account. */
export const AI_USAGE_RELATED_INCLUDE: AiBudgetsRelatedId[] = [
  "chat",
  "pricing",
  "account",
  "governance",
];

export type AiBudgetsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AiBudgetsEmptyCopy = {
  kind: AiBudgetsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Snapshot used to classify Budgets empty vs setup vs ready — no invented DEMO $. */
export type AiBudgetsPolicySnapshot = {
  hasDailySpendLimit: boolean;
  hasMonthlySpendLimit: boolean;
  hasDailyTokenLimit: boolean;
  hasMonthlyTokenLimit: boolean;
  modelAllowlistEnabled: boolean;
  providerAllowlistEnabled: boolean;
  killSwitch: boolean;
};

export function hasAnyAiBudgetCap(policy: AiBudgetsPolicySnapshot): boolean {
  return (
    policy.hasDailySpendLimit ||
    policy.hasMonthlySpendLimit ||
    policy.hasDailyTokenLimit ||
    policy.hasMonthlyTokenLimit ||
    policy.killSwitch
  );
}

/** True when the org still uses platform defaults (no hard limits or allowlists). */
export function isAiBudgetsDefault(policy: AiBudgetsPolicySnapshot): boolean {
  return (
    !hasAnyAiBudgetCap(policy) &&
    !policy.modelAllowlistEnabled &&
    !policy.providerAllowlistEnabled
  );
}

/**
 * Incomplete admin setup: allowlist toggles are on but no spend/token hard cap or kill switch.
 * Never fabricate DEMO limit rows.
 */
export function isAiBudgetsIncompleteSetup(policy: AiBudgetsPolicySnapshot): boolean {
  if (hasAnyAiBudgetCap(policy)) return false;
  return policy.modelAllowlistEnabled || policy.providerAllowlistEnabled;
}

/** Real spend lines only — blank until a ledger value exists; never invent $0.00. */
export function formatAiBudgetsMoney(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `$${n.toFixed(2)}`;
}

/** Real token / call counts only — blank until a ledger value exists. */
export function formatAiBudgetsCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return Math.floor(n).toLocaleString();
}

/** Hide $0 tiles until a real Chat limits / usage ledger is ready. */
export function shouldShowAiBudgetsSummaryTiles(shell: AiBudgetsShellKind): boolean {
  return shell === "ready";
}

export function policySnapshotFromBudgetForm(input: {
  dailySpendLimitUsd?: string | number | null;
  monthlySpendLimitUsd?: string | number | null;
  dailyTokenLimit?: string | number | null;
  monthlyTokenLimit?: string | number | null;
  modelAllowlistEnabled?: boolean;
  providerAllowlistEnabled?: boolean;
  killSwitch?: boolean;
}): AiBudgetsPolicySnapshot {
  const filled = (v: unknown) => {
    if (v == null || v === "") return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  };
  return {
    hasDailySpendLimit: filled(input.dailySpendLimitUsd),
    hasMonthlySpendLimit: filled(input.monthlySpendLimitUsd),
    hasDailyTokenLimit: filled(input.dailyTokenLimit),
    hasMonthlyTokenLimit: filled(input.monthlyTokenLimit),
    modelAllowlistEnabled: Boolean(input.modelAllowlistEnabled),
    providerAllowlistEnabled: Boolean(input.providerAllowlistEnabled),
    killSwitch: Boolean(input.killSwitch),
  };
}

/** Classify Soft-UI shell from Budgets fetch outcome. */
export function classifyAiBudgetsShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  orgId?: string | null;
  policy?: AiBudgetsPolicySnapshot | null;
}): AiBudgetsShellKind {
  if (input.loading) return "loading";
  if (!input.orgId) return "setup";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/admin|administrator|forbidden|permission|access required|manage_api/i.test(message)) {
      return "forbidden";
    }
    return "error";
  }
  if (status != null && status >= 500) return "error";
  const policy = input.policy;
  if (!policy || isAiBudgetsDefault(policy)) return "empty";
  if (isAiBudgetsIncompleteSetup(policy)) return "setup";
  return "ready";
}

/** Soft-UI empty / setup / forbidden copy for Budgets — never DEMO $. */
export function aiBudgetsShellCopy(kind: AiBudgetsShellKind): AiBudgetsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading AI limits…",
        description: "Checking your team's AI limits.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to see AI limits",
        description: "AI limits belong to a team. Sign in, then open AI limits again.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Owners and mentors",
        title: "An owner or mentor sets the AI limits",
        description: "AI follows the limits already saved. Ask an owner or mentor if something is blocked.",
      };
    case "empty":
      return {
        kind,
        badge: "No limit yet",
        title: "No AI limit yet",
        description: "Your team's key is only limited by your provider. Set a monthly limit below if you want one.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Add a limit",
        description: "A list of allowed models doesn't stop spending on its own. Add a monthly limit too.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Couldn't load AI limits",
        description: "Something went wrong loading this page. Try again in a moment.",
      };
    case "ready":
      return {
        kind,
        title: "AI limits",
        description: "Limits are checked before every AI request on your team's key.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Soft-UI next actions for Budgets empty / setup / forbidden.
 * Points at Chat · Pricing · Account — never invents DEMO $.
 */
export function aiBudgetsNextActions(input: {
  orgId?: string | null;
  shell: AiBudgetsShellKind;
  /** When false, limit setup stays with an owner or admin. Omitted keeps the owner actions. */
  canManage?: boolean;
}): AiBudgetsNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Chat limits are saved per team.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const usageHref = hubHref("/ai", "usage", orgId);

  if (input.shell === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Closed membership — Google or email OTP, then reopen AI · Budgets.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.shell === "forbidden" || input.canManage === false) {
    return [
      {
        id: "chat",
        label: "Open Chat",
        detail: "An owner or admin sets spend limits. Chat still follows the limits already saved.",
        href: chatHref,
        primary: true,
      },
    ];
  }

  const actions: AiBudgetsNextAction[] = [];

  if (input.shell === "empty") {
    return [
      {
        id: "configure",
        label: "Set first spend limit",
        detail: "Add a daily or monthly spend or token cap in the form below.",
        href: "#org-hard-limits",
        primary: true,
      },
    ];
  }

  if (input.shell === "setup") {
    return [
      {
        id: "finish",
        label: "Add a spend or token cap",
        detail: "A model list alone does not stop spend — set a dollar or token limit, or pause Chat.",
        href: "#org-hard-limits",
        primary: true,
      },
    ];
  }

  actions.push(
    {
      id: "chat",
      label: "Open Chat",
      detail: "Chat uses these limits — test after saving.",
      href: chatHref,
      primary: true,
    },
    {
      id: "ai-keys",
      label: "Your team's AI key",
      detail: "Vantage's AI runs on your team's own key. Add or change it here.",
      href: withOrgHref("/team/ai-keys", orgId),
    },
    {
      id: "usage",
      label: "Open AI usage",
      detail: "See real Chat calls and refusals.",
      href: usageHref,
    },
  );

  return actions;
}

/** Classify Soft-UI shell from Usage / activity fetch outcome. */
export function classifyAiUsageShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  orgId?: string | null;
  meteredCalls?: number;
}): AiBudgetsShellKind {
  if (input.loading) return "loading";
  if (!input.orgId) return "setup";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/admin|administrator|forbidden|permission|billing|access required|manage_billing/i.test(message)) {
      return "forbidden";
    }
    return "error";
  }
  if (status != null && status >= 500) return "error";
  if (!(Number(input.meteredCalls) > 0)) return "empty";
  return "ready";
}

/** Soft-UI empty / setup copy for AI usage — never DEMO activity. */
export function aiUsageShellCopy(kind: AiBudgetsShellKind): AiBudgetsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading AI usage…",
        description: "Checking Chat calls, which key paid, and any that were refused.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to view AI usage",
        description: "Usage is per team. Sign in, then reopen Usage from Ask AI.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Admins only",
        title: "Owners and mentors see AI usage",
        description: "You can still use Ask AI. Owners and mentors see what the team's key was used for.",
      };
    case "empty":
      return {
        kind,
        badge: "Empty",
        title: "No AI use yet",
        description: "This fills in once someone on the team uses Ask AI or another AI helper.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "AI usage belongs to a team. Choose your team first.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load AI usage",
        description: "Something went wrong loading AI usage. Try again in a moment.",
      };
    case "ready":
      return {
        kind,
        title: "AI usage & activity",
        description: "Every AI request on your team's key: which model, which feature and who asked.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Soft-UI next actions for Usage empty / setup / forbidden.
 * Points at Chat · Pricing · Account (+ Budgets) — never invents DEMO activity.
 */
export function aiUsageNextActions(input: {
  orgId?: string | null;
  shell: AiBudgetsShellKind;
}): AiBudgetsNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Each team has its own AI usage log.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);

  if (input.shell === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Closed membership — Google or email OTP, then reopen AI · Usage.",
        href: "/signin",
        primary: true,
      },
    ];
  }

  if (input.shell === "forbidden") {
    return [
      {
        id: "chat",
        label: "Open Chat",
        detail: "Members can still use the assistant under existing Chat limits.",
        href: chatHref,
        primary: true,
      },
    ];
  }

  const actions: AiBudgetsNextAction[] = [];

  if (input.shell === "empty") {
    return [
      {
        id: "chat",
        label: "Open Chat",
        detail: "Send a real Chat message — the first billed call appears here.",
        href: chatHref,
        primary: true,
      },
    ];
  }


  actions.push(
    {
      id: "budgets",
      label: "Open Chat limits",
      detail: "Set spend and token limits before more Chat calls.",
      href: budgetsHref,
      primary: true,
    },
    {
      id: "chat",
      label: "Open Chat",
      detail: "Chat usage shows here after a real message.",
      href: chatHref,
    },
    {
      id: "ai-keys",
      label: "Your team's AI key",
      detail: "Vantage's AI runs on your team's own key. Add or change it here.",
      href: withOrgHref("/team/ai-keys", orgId),
    },
  );

  // Dedupe chat if already primary
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

/** What Budgets owns vs Usage / Chat / Pricing — Soft-UI clarity cards. */
export const AI_BUDGETS_SCOPE_CARDS = [
  {
    id: "limits" as const,
    title: "This tab · hard limits",
    body: "Daily and monthly spend limits, which models are allowed, a warning percent, and a pause switch. Saved for this team.",
  },
  {
    id: "usage" as const,
    title: "Usage · real ledger",
    body: "Metered calls, funding source, denials, and member/model breakdowns. Empty ledgers stay empty.",
  },
  {
    id: "chat" as const,
    title: "Chat · where it runs",
    body: "Members hit these caps when they message the assistant. Cut-off banners send them back here.",
  },
  {
    id: "pricing" as const,
    title: "Pricing · allowance & credits",
    body: "Included plan allowance, credit packs, pay-as-you-go, and upgrades. Account holds membership; Chat limits holds the team's caps.",
  },
] as const;
