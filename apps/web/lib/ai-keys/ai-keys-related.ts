import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI cross-links for `/team/ai-keys` — never DEMO billing figures. */
export type AiKeysRelatedId =
  | "chat"
  | "budgets"
  | "usage"
  | "byok-usage"
  | "pricing"
  | "account"
  | "admin"
  | "getting-started";

export type AiKeysRelatedLink = {
  id: AiKeysRelatedId;
  label: string;
  href: string;
};

export function aiKeysRelatedLinks(
  orgId?: string | null,
  options?: { active?: AiKeysRelatedId; include?: AiKeysRelatedId[] },
): AiKeysRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  const all: AiKeysRelatedLink[] = [
    { id: "chat", label: "Chat", href: hubHref("/ai", "chat", orgId) },
    { id: "budgets", label: "Chat limits", href: hubHref("/ai", "budgets", orgId) },
    { id: "byok-usage", label: "Your keys usage", href: withOrgHref("/team/ai-usage", orgId) },
    { id: "usage", label: "AI usage", href: withOrgHref("/team/usage", orgId) },
    { id: "pricing", label: "Pricing", href: withOrgHref("/pricing", orgId) },
    { id: "account", label: "Account", href: withOrgHref("/account", orgId) },
    { id: "admin", label: "Custom providers", href: `${withOrgHref("/team/admin", orgId)}#custom-providers` },
    {
      id: "getting-started",
      label: "Team setup",
      href: withOrgHref("/team/getting-started", orgId),
    },
  ];
  return all.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  });
}

export const AI_KEYS_RELATED_INCLUDE: AiKeysRelatedId[] = ["chat"];

export type AiKeysShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "forbidden"
  | "auth_required"
  | "error";

export function classifyAiKeysShell(input: {
  loading: boolean;
  authRequired?: boolean;
  setupRequired?: boolean;
  forbidden?: boolean;
  error?: string;
  hasOrg: boolean;
}): AiKeysShellKind {
  if (input.loading) return "loading";
  if (input.authRequired) return "auth_required";
  if (!input.hasOrg) return "empty";
  if (input.setupRequired) return "setup";
  if (input.forbidden) return "forbidden";
  if (input.error?.trim()) return "error";
  return "ready";
}

export function aiKeysShellCopy(kind: AiKeysShellKind, detail?: string | null): {
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
} {
  if (kind === "loading") {
    return {
      eyebrow: "AI KEYS",
      title: "Loading encrypted key status…",
      description: "Checking which first-party providers are configured for this team.",
    };
  }
  if (kind === "auth_required") {
    return {
      eyebrow: "SIGN IN REQUIRED",
      title: "Sign in to manage API keys",
      description: "Your keys are encrypted for this team. Sign in, then open this page from Account or Team setup.",
      badge: "Auth required",
    };
  }
  if (kind === "empty") {
    return {
      eyebrow: "CHOOSE A TEAM",
      title: "Choose your team to add API keys",
      description: "Choose your team, then return here to paste keys for yourself or the team.",
      badge: "No team",
    };
  }
  if (kind === "setup") {
    return {
      eyebrow: "SETUP REQUIRED",
      title: "Key encryption is not available",
      description:
        detail?.trim() ||
        "This deployment cannot envelope-encrypt API keys yet (KMS / local vault missing). Keys are not accepted until encryption is configured — nothing crashes, and no plaintext is stored.",
      badge: "Setup required",
    };
  }
  if (kind === "forbidden") {
    return {
      eyebrow: "PERMISSION NEEDED",
      title: "Team keys are admin-only",
      description:
        detail?.trim() ||
        "Anyone on the team can save personal keys. Team-wide keys require Manage API keys (owner/admin).",
      badge: "View only",
    };
  }
  if (kind === "error") {
    return {
      eyebrow: "COULD NOT LOAD",
      title: "Could not load AI key status",
      description: detail?.trim() || "Retry when the network or database is available.",
      badge: "Retry",
    };
  }
  return {
    eyebrow: "AI KEYS",
    title: "Your keys or the team's",
    description:
      "Paste OpenAI or Anthropic, or point OpenAI at Ollama / LM Studio. Your keys override the team's for your chats. Hosted AI is used when nothing is saved.",
  };
}

/** Billing framing — your keys vs hosted native AI (aligned with pricing soft-copy). */
export function aiKeysBillingNote(tier: string | null | undefined): { title: string; body: string } {
  const normalized = (tier ?? "free").toLowerCase();
  if (normalized === "free") {
    return {
      title: "Free · hosted free models or your keys",
      body: "Free teams use the platform OpenRouter free pool for chat unless you paste your own OpenAI, Anthropic, Google, or OpenRouter key. A local OpenAI-compatible relay still works. Paid Individual/Team plans use hosted Anthropic (Sonnet, or Opus for CAD/code).",
    };
  }
  return {
    title: "Paid · hosted AI",
    body: "Prefer Vantage-hosted Anthropic (Sonnet for chat/strategy, Opus for CAD/code) in the product, then buy AI credits or turn on pay-as-you-go when you need more. Credits go further than running the same models on your own keys. You can still paste your own keys; that traffic does not consume hosted usage.",
  };
}
