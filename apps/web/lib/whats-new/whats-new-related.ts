/** Soft-UI related surfaces for What’s new / product releases (never DEMO history). */
export const WHATS_NEW_RELATED_LINKS = [
  { id: "support", label: "Help & Support", href: "/support" },
  { id: "pricing", label: "Pricing", href: "/pricing" },
  { id: "inbox", label: "Inbox", href: "/notifications" },
  { id: "preferences", label: "Notification prefs", href: "/notifications/preferences" },
] as const;

export type WhatsNewRelatedId = (typeof WHATS_NEW_RELATED_LINKS)[number]["id"];

export type WhatsNewRelatedLink = {
  id: WhatsNewRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Support · Pricing · Inbox. */
export const WHATS_NEW_RELATED_INCLUDE: WhatsNewRelatedId[] = ["support", "pricing", "inbox"];

/** Cross-links for What’s new Soft-UI (never DEMO release cards). */
export function whatsNewRelatedLinks(options?: {
  active?: WhatsNewRelatedId;
  include?: WhatsNewRelatedId[];
}): WhatsNewRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return WHATS_NEW_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({ id: link.id, label: link.label, href: link.href }));
}

export type WhatsNewNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for What’s new.
 * Empty stay empty until a real published product_releases row targets the user’s plan — never DEMO history.
 */
export function whatsNewNextActions(input: {
  releaseCount: number;
  unreadCount?: number;
}): WhatsNewNextAction[] {
  const actions: WhatsNewNextAction[] = [];

  if (input.releaseCount === 0) {
    actions.push({
      id: "empty",
      label: "No published releases yet",
      detail:
        "This feed stays blank until Vantage publishes a release that matches your team’s plan.",
      href: "/whats-new",
      primary: true,
    });
    actions.push({
      id: "pricing",
      label: "Compare plans on Pricing",
      detail: "Some notes target paid or Max entitlements — check which unlocks apply to your workspace.",
      href: "/pricing",
    });
    actions.push({
      id: "support",
      label: "Ask Help & Support",
      detail: "If a published unlock is missing from this list, open a ticket instead of inventing history.",
      href: "/support",
    });
    actions.push({
      id: "preferences",
      label: "Tune release emails",
      detail: "Choose inbox vs email delivery for product updates when the next real note ships.",
      href: "/notifications/preferences",
    });
    return actions;
  }

  if ((input.unreadCount ?? 0) > 0) {
    actions.push({
      id: "unread",
      label: `Review ${input.unreadCount} unread release${input.unreadCount === 1 ? "" : "s"}`,
      detail: "Mark as read after you’ve skimmed the notes — acks come from real product_release_acks rows.",
      href: "/whats-new",
      primary: true,
    });
  }

  actions.push(
    {
      id: "inbox",
      label: "Open Inbox",
      detail: "In-app release notifications land here when notify-in-app is enabled on a publish.",
      href: "/notifications",
      primary: actions.length === 0,
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Report a regression or ask how a new unlock maps to your workflow.",
      href: "/support",
    },
    {
      id: "pricing",
      label: "Pricing",
      detail: "See which plan tiers unlock the feature flags called out in release notes.",
      href: "/pricing",
    },
  );

  return actions.slice(0, 5);
}

/** Audience label for Soft-UI cards — blank-safe, never DEMO cohorts. */
export function formatReleaseAudience(audienceType: string): string {
  switch (audienceType) {
    case "all":
      return "All plans";
    case "paid":
      return "Paid plans";
    case "max":
      return "Max plans";
    case "plan_codes":
      return "Selected plans";
    default:
      return "Release";
  }
}

/** Published date for Soft-UI — blank until a real published_at exists. */
export function formatReleasePublishedAt(publishedAt: string | null | undefined): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Feature flags that are actually unlocked on this release — never invent DEMO flags. */
export function enabledReleaseFlags(flags: Record<string, boolean> | null | undefined): string[] {
  if (!flags) return [];
  return Object.keys(flags)
    .filter((key) => flags[key] === true)
    .sort();
}
