import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI shell kinds for `/ai?tab=governance` — never DEMO policy stats. */
export type AiGovernanceShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "forbidden"
  | "auth_required"
  | "error";

export type AiGovernanceRelatedId =
  | "chat"
  | "budgets"
  | "memory"
  | "finance"
  | "usage"
  | "runs"
  | "admin";

export type AiGovernanceRelatedLink = {
  id: AiGovernanceRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from AI Governance → Memory / Budgets / Chat first.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function aiGovernanceRelatedLinks(
  orgId?: string | null,
  options?: { active?: AiGovernanceRelatedId; include?: AiGovernanceRelatedId[] },
): AiGovernanceRelatedLink[] {
  if (!orgId) return [];
  const include = options?.include ? new Set(options.include) : null;
  const all: AiGovernanceRelatedLink[] = [
    { id: "chat", label: "Chat", href: hubHref("/ai", "chat", orgId) },
    { id: "budgets", label: "Budgets", href: hubHref("/ai", "budgets", orgId) },
    { id: "memory", label: "Memory", href: hubHref("/ai", "memory", orgId) },
    { id: "finance", label: "Finance in Ask AI", href: hubHref("/ai", "finance", orgId) },
    { id: "usage", label: "AI usage", href: withOrgHref("/team/usage", orgId) },
    { id: "runs", label: "AI runs", href: withOrgHref("/team/ai-runs", orgId) },
    { id: "admin", label: "Team admin", href: withOrgHref("/team/admin", orgId) },
  ];
  return all.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  });
}

/** Primary Soft-UI strip: Chat · Budgets · Memory. */
export const AI_GOVERNANCE_RELATED_INCLUDE: AiGovernanceRelatedId[] = [
  "chat",
  "budgets",
  "memory",
  "finance",
];

export type AiGovernanceNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AiGovernanceEmptyCopy = {
  kind: AiGovernanceShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Snapshot used to classify empty vs setup vs ready — no invented DEMO stats. */
export type AiGovernancePolicySnapshot = {
  featureAllowlistEnabled: boolean;
  allowedFeaturesCount: number;
  toolAllowlistEnabled: boolean;
  allowedToolsCount: number;
  requireApprovalAboveThreshold: boolean;
  highCostThresholdSet: boolean;
  requireApprovalForFeaturesCount: number;
  financeInAiEnabled: boolean;
  dailySpendAlertSet: boolean;
  monthlySpendAlertSet: boolean;
  pendingApprovals: number;
};

/** True when the org still uses platform defaults (no org gates, alerts, or Finance-in-AI). */
export function isAiGovernanceLaissezFaire(policy: AiGovernancePolicySnapshot): boolean {
  return (
    !policy.featureAllowlistEnabled &&
    !policy.toolAllowlistEnabled &&
    !policy.requireApprovalAboveThreshold &&
    policy.requireApprovalForFeaturesCount === 0 &&
    !policy.financeInAiEnabled &&
    !policy.dailySpendAlertSet &&
    !policy.monthlySpendAlertSet &&
    policy.pendingApprovals === 0
  );
}

/**
 * Incomplete admin setup: an allowlist/approval gate is on but nothing is selected,
 * or high-cost approval is on without a threshold. Never fabricate DEMO policy rows.
 */
export function isAiGovernanceIncompleteSetup(policy: AiGovernancePolicySnapshot): boolean {
  if (policy.featureAllowlistEnabled && policy.allowedFeaturesCount === 0) return true;
  if (policy.toolAllowlistEnabled && policy.allowedToolsCount === 0) return true;
  if (policy.requireApprovalAboveThreshold && !policy.highCostThresholdSet) return true;
  return false;
}

/** Real spend lines only — blank until the policy load succeeds; never DEMO $. */
export function formatAiGovernanceMoney(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "$0.00";
  return `$${n.toFixed(2)}`;
}

/** Real pending-approval counts only — never invent DEMO queue totals. */
export function formatAiGovernanceCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Soft-UI shell from AI policy fetch outcome. */
export function classifyAiGovernanceShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  policy?: AiGovernancePolicySnapshot | null;
}): AiGovernanceShellKind {
  if (input.loading) return "loading";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403) return "forbidden";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/admin|administrator|forbidden|permission|access required/i.test(message)) {
      return "forbidden";
    }
    return "error";
  }
  if (status != null && status >= 500) return "error";
  const policy = input.policy;
  if (!policy) return "empty";
  if (isAiGovernanceLaissezFaire(policy)) return "empty";
  if (isAiGovernanceIncompleteSetup(policy)) return "setup";
  return "ready";
}

/** Soft-UI empty / setup / forbidden copy — never DEMO policy stats. */
export function aiGovernanceShellCopy(kind: AiGovernanceShellKind): AiGovernanceEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading AI governance…",
        description: "Checking your team's policy, spend alerts, and the high-cost approval queue.",
      };
    case "auth_required":
      return {
        kind,
        badge: "Sign in",
        title: "Sign in to manage AI governance",
        description: "Governance is per team. Sign in, then reopen it from Ask AI.",
      };
    case "forbidden":
      return {
        kind,
        badge: "Admins only",
        title: "AI governance needs an admin",
        description:
          "Owners and admins set which tools Ask AI may use, spend alerts, and whether it can read finance summaries. Members still use Chat under existing Budgets and Memory rules.",
      };
    case "empty":
      return {
        kind,
        badge: "Defaults",
        title: "No org gates yet",
        description:
          "Platform defaults apply until an admin turns on approved features and tools, high-cost approval, spend alerts, or finance in Ask AI. Spend and queue totals stay blank until real rows exist.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Finish the policy you started",
        description:
          "A feature list or high-cost gate is on but incomplete (no features or tools selected, or no dollar threshold).",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load AI governance",
        description:
          "A network or server issue blocked the policy load. Retry, or check Budgets if metered AI is cut off.",
      };
    default:
      return {
        kind: "ready",
        title: "Org AI governance",
        description:
          "Which tools Chat may use, who must approve a costly call, and spend alerts live here. Which models are allowed and Pause Chat live under Chat limits; shared memory under Memory.",
      };
  }
}

/**
 * Soft-UI next actions for empty / setup / forbidden Governance.
 * Points at Memory · Budgets · Chat — never invents DEMO policy stats.
 */
export function aiGovernanceNextActions(input: {
  orgId?: string | null;
  shell: AiGovernanceShellKind;
}): AiGovernanceNextAction[] {
  const orgId = input.orgId ?? null;
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "AI governance is saved per org — pick a team first.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const chatHref = hubHref("/ai", "chat", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);

  if (input.shell === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Closed membership — Google or email OTP, then reopen AI · Governance.",
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
        detail: "Members can still use the assistant under Budgets and Memory policy set by admins.",
        href: chatHref,
        primary: true,
      },
      {
        id: "budgets",
        label: "Open Budgets",
        detail: "Spend limits and which models are allowed live next to Chat — this form is a separate set of gates.",
        href: budgetsHref,
      },
      {
        id: "memory",
        label: "Open Memory",
        detail: "Team memory is a separate admin opt-in from which tools Chat may use.",
        href: memoryHref,
      },
    ];
  }

  const actions: AiGovernanceNextAction[] = [];

  if (input.shell === "empty") {
    actions.push({
      id: "configure",
      label: "Set first org gate",
      detail: "Turn on approved features or tools, high-cost approval, or a spend alert in the form below.",
      href: "#ai-governance-policy",
      primary: true,
    });
  } else if (input.shell === "setup") {
    actions.push({
      id: "finish",
      label: "Finish incomplete policy",
      detail: "Choose allowed features or tools, or set a USD threshold for high-cost approval.",
      href: "#ai-governance-policy",
      primary: true,
    });
  }

  actions.push(
    {
      id: "chat",
      label: "Open Chat",
      detail: "Policy is enforced when members call the assistant — test after saving.",
      href: chatHref,
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "budgets",
      label: "Open Chat limits",
      detail: "Which models and providers are allowed, and Pause Chat, live on Chat limits — not this form.",
      href: budgetsHref,
    },
    {
      id: "memory",
      label: "Open Memory",
      detail: "Shared team memory is opt-in under Memory — separate from which tools Chat may use.",
      href: memoryHref,
    },
  );

  return actions;
}

/** What this tab owns vs Budgets / Memory / Chat — Soft-UI clarity cards. */
export const AI_GOVERNANCE_SCOPE_CARDS = [
  {
    id: "policy" as const,
    title: "This tab · org policy",
    body: "Which features and tools members may use, high-cost approval, spend alerts, and consent for Ask AI to read finance summaries. Saved per team.",
  },
  {
    id: "budgets" as const,
    title: "Chat limits · models & spend",
    body: "Daily and monthly spend limits, which models are allowed, a warning percent, and Pause Chat. Edit there — this page only mirrors which models are allowed.",
  },
  {
    id: "memory" as const,
    title: "Memory · shared injection",
    body: "Whether team-promoted memories enter prompts. Private Chat memory stays private and is never auto-promoted into governance stats.",
  },
  {
    id: "chat" as const,
    title: "Chat · where it runs",
    body: "Members hit these rules when they message the assistant. Empty spend stays at zero until someone uses Chat.",
  },
] as const;
