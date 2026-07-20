import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces from Account (never DEMO plan/usage figures). */
export const ACCOUNT_RELATED_LINKS = [
  { id: "ai-keys", label: "AI API keys", kind: "path" as const, path: "/team/ai-keys" },
  { id: "billing", label: "Billing", kind: "hub" as const, hub: "/ai" as const, tab: "budgets" },
  { id: "usage", label: "AI usage", kind: "path" as const, path: "/team/usage" },
  { id: "support", label: "Help & Support", kind: "path" as const, path: "/support" },
  { id: "whats-new", label: "What’s new", kind: "path" as const, path: "/whats-new" },
  { id: "security", label: "Security", kind: "path" as const, path: "/security" },
  { id: "workspace", label: "Workspace", kind: "path" as const, path: "/workspace" },
] as const;

export type AccountRelatedId = (typeof ACCOUNT_RELATED_LINKS)[number]["id"];

export type AccountRelatedLink = {
  id: AccountRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — AI keys · Billing · Usage · Support. */
export const ACCOUNT_RELATED_INCLUDE: AccountRelatedId[] = [
  "ai-keys",
  "billing",
  "usage",
  "support",
];

/** Cross-links for Account Soft-UI (never DEMO billing or release history). */
export function accountRelatedLinks(
  orgId?: string | null,
  options?: { active?: AccountRelatedId; include?: AccountRelatedId[] },
): AccountRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ACCOUNT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref(link.hub, link.tab, orgId) };
    }
    // Personal / platform chrome — leave paths org-free (support is also ORG_EXEMPT).
    if (link.id === "support" || link.id === "whats-new" || link.id === "security") {
      return { id: link.id, label: link.label, href: link.path };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type AccountNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AccountOrgContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  planCode: string | null;
};

/** Soft-UI label for an org role — blank-safe, never a DEMO title. */
export function formatAccountRole(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  const normalized = role.trim().toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  if (normalized === "mentor") return "Mentor";
  if (normalized === "member") return "Member";
  if (normalized === "viewer") return "Viewer";
  return role.trim();
}

/** One-line workspace context — blank until a real membership exists. */
export function formatAccountOrgLabel(input: AccountOrgContext): string | null {
  if (!input.orgId) return null;
  const team =
    input.teamNumber != null && Number.isFinite(input.teamNumber) ? `Team ${input.teamNumber}` : null;
  const name = input.orgName?.trim() || null;
  const role = formatAccountRole(input.role);
  const parts = [team, name, role].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Active workspace";
}

/**
 * Soft-UI next actions for Account empty / setup.
 * Points at Workspace, AI keys, Billing, Usage, and Support — never invents DEMO plan history.
 */
export function accountNextActions(input: {
  orgId?: string | null;
  hasProfile?: boolean;
  emailDeliveryReady?: boolean;
  googleReady?: boolean;
  tbaReady?: boolean;
}): AccountNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select a workspace",
        detail: "AI keys, billing, and team connectors need an active team — profile prefs still save for this login.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "support",
        label: "Help & Support",
        detail: "Ask for team access if you expected a membership and don’t see a workspace yet.",
        href: "/support",
      },
      {
        id: "whats-new",
        label: "What’s new",
        detail: "Published release notes for your plan — the feed stays empty until a real note ships.",
        href: "/whats-new",
      },
    ];
  }

  const actions: AccountNextAction[] = [];

  if (input.hasProfile === false) {
    actions.push({
      id: "profile",
      label: "Save a display name",
      detail: "Your profile stays blank until you set a name — nothing is invented for teammates.",
      href: "/account?tab=profile",
      primary: true,
    });
  }

  if (input.emailDeliveryReady === false) {
    actions.push({
      id: "email-setup",
      label: "Email delivery not configured",
      detail: "Opt-in emails need Resend on this deployment. In-app prefs still save; transactional mail stays setup-required.",
      href: "/account?tab=notifications",
      primary: actions.length === 0,
    });
  }

  if (input.tbaReady === false) {
    actions.push({
      id: "tba",
      label: "Configure TBA connectors",
      detail: "Match alerts stay quiet until a TBA key or Neon cache sync exists — never DEMO matches.",
      href: withOrgHref("/team/data", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.googleReady === false) {
    actions.push({
      id: "google",
      label: "Google sign-in setup",
      detail: "This deployment is missing Google OAuth env — use email OTP until an admin configures it.",
      href: "/account?tab=integrations",
    });
  }

  actions.push(
    {
      id: "ai-keys",
      label: "Add AI API keys",
      detail: "Paste OpenAI, Anthropic, or Google keys for this workspace — encrypted; no invented spend.",
      href: withOrgHref("/team/ai-keys", orgId),
      primary: actions.length === 0,
    },
    {
      id: "billing",
      label: "Open billing & budgets",
      detail: "API spend caps and Usage Credits for this workspace — figures come from the live ledger only.",
      href: hubHref("/ai", "budgets", orgId),
    },
    {
      id: "usage",
      label: "Review AI usage",
      detail: "Metered feature spend for the active team. Empty until real AI calls land in the ledger.",
      href: withOrgHref("/team/usage", orgId),
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Open a ticket if profile, billing, or notification prefs look wrong for this account.",
      href: "/support",
    },
  );

  return actions.slice(0, 5);
}
