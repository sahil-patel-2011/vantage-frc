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

/** Real spend lines only — blank until load succeeds; never DEMO $. */
export function formatAiBudgetsMoney(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "$0.00";
  return `$${n.toFixed(2)}`;
}

/** Real token / call counts only — never invent DEMO totals. */
export function formatAiBudgetsCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
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
        title: "Loading API budgets…",
        description: "Checking your team's hard limits, allowlists, and included allowance.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to manage API budgets",
        description: "Spend caps and kill switches are workspace-scoped. Sign in, then reopen Budgets from the AI hub.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Admins only",
        title: "API budgets need an admin",
        description:
          "Owners and admins set hard spend/token caps and model allowlists. Members still use Chat under existing caps — open Pricing or Account if you need plan access.",
      };
    case "empty":
      return {
        kind,
        badge: "Defaults",
        title: "No org hard limits yet",
        description:
          "Platform included allowance still hard-stops at 100%. Set daily/monthly spend or token caps below — ledger totals stay at real Neon zeros.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Finish budget setup",
        description:
          "Finish workspace selection or add a real spend/token hard cap next to any allowlist toggle. Chat, Pricing, and Account stay one hop away.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load API budgets",
        description:
          "A network or server issue blocked budget policy. Retry, or open Chat / Pricing / Account while it reloads.",
      };
    default:
      return {
        kind: "ready",
        title: "API budgets",
        description:
          "Hard spend and token limits checked before every metered AI call. Included plan allowance hard-stops unless you buy Usage Credits or enable PAYG.",
      };
  }
}

/**
 * Soft-UI next actions for Budgets empty / setup / forbidden.
 * Points at Chat · Pricing · Account — never invents DEMO $.
 */
export function aiBudgetsNextActions(input: {
  orgId?: string | null;
  shell: AiBudgetsShellKind;
}): AiBudgetsNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "API budgets are saved per org — pick a team first.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Confirm membership and plan access from Account.",
        href: withOrgHref("/account", null),
      },
      {
        id: "pricing",
        label: "View pricing",
        detail: "Included allowance and Usage Credits are listed on Pricing.",
        href: withOrgHref("/pricing", null),
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const pricingHref = withOrgHref("/pricing", orgId);
  const accountHref = withOrgHref("/account", orgId);
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

  if (input.shell === "forbidden") {
    return [
      {
        id: "chat",
        label: "Open Chat",
        detail: "Members can still use the assistant under existing org caps.",
        href: chatHref,
        primary: true,
      },
      {
        id: "pricing",
        label: "View pricing",
        detail: "Compare included allowance and Usage Credit packs.",
        href: pricingHref,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Check your role and workspace membership.",
        href: accountHref,
      },
    ];
  }

  const actions: AiBudgetsNextAction[] = [];

  if (input.shell === "empty") {
    actions.push({
      id: "configure",
      label: "Set first hard limit",
      detail: "Add a daily or monthly spend / token cap in the organization form below.",
      href: "#org-hard-limits",
      primary: true,
    });
  } else if (input.shell === "setup") {
    actions.push({
      id: "finish",
      label: "Add a spend or token cap",
      detail: "Allowlists alone do not hard-stop spend — set a numeric limit or kill switch.",
      href: "#org-hard-limits",
      primary: true,
    });
  }

  actions.push(
    {
      id: "chat",
      label: "Open Chat",
      detail: "Metered calls enforce these caps — test after saving.",
      href: chatHref,
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "pricing",
      label: "View pricing",
      detail: "Buy AI credits, enable PAYG, or upgrade after hosted usage runs out.",
      href: pricingHref,
    },
    {
      id: "account",
      label: "Open Account",
      detail: "Plan seating and workspace membership live under Account.",
      href: accountHref,
    },
    {
      id: "usage",
      label: "Open AI usage",
      detail: "See real metered calls and denials.",
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
  hasPlan?: boolean;
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
  if (!input.hasPlan) return "setup";
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
        description: "Checking metered calls, funding sources, and denials.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to view AI usage",
        description: "Usage ledgers are workspace-scoped. Sign in, then reopen Usage from the AI hub.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Admins only",
        title: "AI usage needs billing access",
        description:
          "Owners and admins review metered spend. Members can still open Chat under Budgets — Pricing and Account stay available.",
      };
    case "empty":
      return {
        kind,
        badge: "Empty",
        title: "No metered AI calls yet",
        description:
          "This ledger stays empty until a real Chat or feature call is metered. Totals stay at Neon zeros.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Select a workspace and plan",
        description:
          "Usage needs an org with entitlements. Open Account or Pricing, then Chat to generate the first real metered call.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load AI usage",
        description:
          "A network or server issue blocked the usage ledger. Retry, or open Chat / Budgets / Pricing.",
      };
    default:
      return {
        kind: "ready",
        title: "AI usage & activity",
        description:
          "A transparent record of every metered AI call — model, feature, member, and which key funded it.",
      };
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
        label: "Select workspace",
        detail: "Pick a team first.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Confirm membership from Account.",
        href: withOrgHref("/account", null),
      },
      {
        id: "pricing",
        label: "View pricing",
        detail: "Included allowance lives on Pricing.",
        href: withOrgHref("/pricing", null),
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const pricingHref = withOrgHref("/pricing", orgId);
  const accountHref = withOrgHref("/account", orgId);

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
        detail: "Members can still use the assistant under existing Budgets caps.",
        href: chatHref,
        primary: true,
      },
      {
        id: "budgets",
        label: "Open Budgets",
        detail: "Hard limits and kill switch live next to Usage on the AI hub.",
        href: budgetsHref,
      },
      {
        id: "pricing",
        label: "View pricing",
        detail: "Compare plans and Usage Credits.",
        href: pricingHref,
      },
      {
        id: "account",
        label: "Open Account",
        detail: "Check your role and workspace membership.",
        href: accountHref,
      },
    ];
  }

  const actions: AiBudgetsNextAction[] = [];

  if (input.shell === "empty") {
    actions.push({
      id: "chat",
      label: "Open Chat",
      detail: "Send a real assistant message — the first metered call appears here.",
      href: chatHref,
      primary: true,
    });
  } else if (input.shell === "setup") {
    actions.push({
      id: "pricing",
      label: "View pricing",
      detail: "Confirm a plan entitlement, then return to Usage.",
      href: pricingHref,
      primary: true,
    });
  }

  actions.push(
    {
      id: "budgets",
      label: "Open Budgets",
      detail: "Set hard spend/token caps before more metered calls.",
      href: budgetsHref,
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "chat",
      label: "Open Chat",
      detail: "Metered Chat calls populate this ledger from Neon only.",
      href: chatHref,
    },
    {
      id: "pricing",
      label: "View pricing",
      detail: "Buy AI credits or upgrade when hosted usage is exhausted.",
      href: pricingHref,
    },
    {
      id: "account",
      label: "Open Account",
      detail: "Plan seating and workspace membership live under Account.",
      href: accountHref,
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
    body: "Daily/monthly spend and token caps, model/provider allowlists, warning %, kill switch, and prompt caching. Saved to Neon per workspace.",
  },
  {
    id: "usage" as const,
    title: "Usage · real ledger",
    body: "Metered calls, funding source, denials, and member/model breakdowns. Empty ledgers stay empty.",
  },
  {
    id: "chat" as const,
    title: "Chat · where it runs",
    body: "Members hit these caps when they message the assistant. Cut-off banners deep-link back here via hubHref.",
  },
  {
    id: "pricing" as const,
    title: "Pricing · allowance & credits",
    body: "Included plan allowance, Usage Credit packs, PAYG, and upgrades. Account holds membership; Budgets holds org hard caps.",
  },
] as const;
