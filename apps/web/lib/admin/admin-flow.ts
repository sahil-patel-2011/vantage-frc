/** Soft-UI helpers for `/admin` — platform_admins only, never DEMO metrics. */

export type AdminShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "forbidden"
  | "setup_required"
  | "auth_required";

export type AdminEmptyCopy = {
  kind: AdminShellKind;
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
};

export type AdminNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Platform admin cross-links that already ship under `/admin/*`. */
export const ADMIN_RELATED_LINKS = [
  { id: "teams", label: "Teams", href: "/admin" },
  { id: "waitlist", label: "Waitlist", href: "/admin/waitlist" },
  { id: "partners", label: "Partners", href: "/admin/partners" },
  { id: "outreach", label: "Outreach", href: "/admin/outreach" },
  { id: "plans", label: "Org plans", href: "/admin/plans" },
  { id: "support", label: "Support", href: "/admin/support" },
  { id: "releases", label: "Releases", href: "/admin/releases" },
  { id: "audit", label: "Audit log", href: "/admin/audit" },
] as const;

export type AdminRelatedId = (typeof ADMIN_RELATED_LINKS)[number]["id"];

export type AdminRelatedLink = {
  id: AdminRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Plans · Support · Releases (plus Waitlist on the Teams hub). */
export const ADMIN_RELATED_INCLUDE: AdminRelatedId[] = [
  "plans",
  "support",
  "releases",
  "waitlist",
];

/** Cross-links for platform admin Soft-UI — never DEMO billing or invented ticket/release counts. */
export function adminRelatedLinks(options?: {
  active?: AdminRelatedId;
  include?: AdminRelatedId[];
}): AdminRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ADMIN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({ id: link.id, label: link.label, href: link.href }));
}

/**
 * Safe provisioning deep-link. Build with URLSearchParams — never inline JSX
 * template bugs like `{/admin?ownerEmail=}`.
 */
export function adminProvisionHref(input: {
  ownerEmail: string;
  teamNumber: number | string;
}): string {
  const params = new URLSearchParams();
  const email = input.ownerEmail.trim();
  const team = String(input.teamNumber).trim();
  if (email) params.set("ownerEmail", email);
  if (team) params.set("teamNumber", team);
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

/** Soft-UI org row label — blank-safe, never a DEMO team name. */
export function formatAdminOrgLabel(input: {
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail?: string | null;
}): string {
  const team =
    input.teamNumber != null && Number.isFinite(input.teamNumber) ? `#${input.teamNumber}` : null;
  const name = input.name?.trim() || null;
  const slug = input.slug?.trim() || null;
  const owner = input.ownerEmail?.trim() || null;
  const parts = [team, name, slug, owner].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Provisioned team";
}

/** Only report a real organization count — never invent DEMO metrics. */
export function adminOrgMetric(count: number | null | undefined, loaded: boolean): string {
  if (!loaded) return "…";
  if (count == null || !Number.isFinite(count) || count < 0) return "0";
  return String(Math.floor(count));
}

/** Classify Soft-UI shell from organizations fetch outcome. */
export function classifyAdminShell(input: {
  loading: boolean;
  status?: number | null;
  error?: string | null;
  organizationCount: number;
}): AdminShellKind {
  if (input.loading) return "loading";
  const status = input.status ?? null;
  if (status === 401) return "auth_required";
  if (status === 403 || status === 404) return "forbidden";
  if (status != null && status >= 500) return "setup_required";
  if (input.error?.trim()) {
    const message = input.error.toLowerCase();
    if (/auth|sign.?in|session/i.test(message)) return "auth_required";
    if (/not found|forbidden|platform.?admin|access.?denied/i.test(message)) return "forbidden";
    if (/setup|database|configure|unavailable|network/i.test(message)) return "setup_required";
    return "setup_required";
  }
  if (input.organizationCount < 1) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / forbidden copy — never invents provisioned teams. */
export function adminEmptyCopy(kind: AdminShellKind, detail?: string | null): AdminEmptyCopy {
  if (kind === "loading") {
    return {
      kind,
      eyebrow: "PLATFORM ADMIN",
      title: "Loading team provisioning…",
      description:
        "Checking platform_admins access and loading real organization rows. Counts stay blank until the query returns.",
    };
  }
  if (kind === "auth_required") {
    return {
      kind,
      eyebrow: "SIGN IN REQUIRED",
      title: "Sign in to continue",
      description:
        detail?.trim() ||
        "Platform admin surfaces require a verified session. Sign in, then open Global Team Manager again.",
      badge: "Setup required",
    };
  }
  if (kind === "forbidden") {
    return {
      kind,
      eyebrow: "PLATFORM ACCESS",
      title: "Platform admin access required",
      description:
        detail?.trim() ||
        "This surface is gated to platform_admins. Org Team Admin under Team is separate and does not unlock Global Team Manager.",
      badge: "Forbidden",
    };
  }
  if (kind === "setup_required") {
    return {
      kind,
      eyebrow: "SETUP REQUIRED",
      title: "Platform admin data is unavailable",
      description:
        detail?.trim() ||
        "Organization provisioning could not load. Confirm database connectivity.",
      badge: "setup_required",
    };
  }
  if (kind === "empty") {
    return {
      kind,
      eyebrow: "CLOSED MEMBERSHIP",
      title: "No teams provisioned yet",
      description:
        detail?.trim() ||
        "Create the first workspace below, or start from a waitlist entry. Membership stays closed until a platform admin seeds an owner.",
      badge: "Empty",
    };
  }
  return {
    kind: "ready",
    eyebrow: "PLATFORM ADMIN",
    title: "Team provisioning",
    description:
      "Closed membership: provision each team workspace and seed the first owner. Launch interest lives on the waitlist surface.",
  };
}

/**
 * Soft-UI next actions for the Teams hub.
 * Points at Plans, Support, Releases, and Waitlist — never invents DEMO ledger or ticket rows.
 */
export function adminNextActions(kind: AdminShellKind): AdminNextAction[] {
  if (kind === "auth_required") {
    return [
      {
        id: "signin",
        label: "Sign in",
        detail: "Use a verified platform_admins account. Closed waitlist access — no public admin signup.",
        href: "/signin?next=%2Fadmin",
        primary: true,
      },
    ];
  }

  if (kind === "forbidden") {
    return [
      {
        id: "workspace",
        label: "Back to workspace",
        detail: "Team tools and org admin live under Team — they do not grant platform_admins.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "support",
        label: "Member support",
        detail: "Open a Help & Support ticket if you expected platform access and do not have it.",
        href: "/support",
      },
    ];
  }

  if (kind === "setup_required") {
    return [
      {
        id: "retry",
        label: "Retry Teams hub",
        detail: "Reload after database connectivity recovers. Counts stay honest — empty until rows return.",
        href: "/admin",
        primary: true,
      },
      {
        id: "audit",
        label: "Audit log",
        detail: "When admin APIs are healthy, privileged actions land here.",
        href: "/admin/audit",
      },
    ];
  }

  const actions: AdminNextAction[] = [];

  if (kind === "empty") {
    actions.push({
      id: "waitlist",
      label: "Open waitlist",
      detail: "Review launch interest, then jump back here with owner email + team number prefilled.",
      href: "/admin/waitlist",
      primary: true,
    });
  } else {
    actions.push({
      id: "waitlist",
      label: "Review waitlist",
      detail: "Mark outreach and provision owners from real launch interest only.",
      href: "/admin/waitlist",
      primary: true,
    });
  }

  actions.push(
    {
      id: "plans",
      label: "Org plans",
      detail: "Entitlement status and Stripe IDs from the live ledger.",
      href: "/admin/plans",
    },
    {
      id: "support",
      label: "Support triage",
      detail: "Member-reported tickets only. Replies show on the submitter’s Support page.",
      href: "/admin/support",
    },
    {
      id: "releases",
      label: "Product releases",
      detail: "Stage and publish real release notes. What’s new stays empty until you publish.",
      href: "/admin/releases",
    },
  );

  return actions.slice(0, 5);
}
