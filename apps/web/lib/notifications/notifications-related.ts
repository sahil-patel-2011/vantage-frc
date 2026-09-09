/** Soft-UI related surfaces for the account inbox (never DEMO notifications). */
export const NOTIFICATION_RELATED_LINKS = [
  { id: "whats-new", label: "What’s new", href: "/whats-new" },
  { id: "support", label: "Help & Support", href: "/support" },
  { id: "account", label: "Account", href: "/account" },
  { id: "preferences", label: "Notification prefs", href: "/notifications/preferences" },
] as const;

export type NotificationRelatedId = (typeof NOTIFICATION_RELATED_LINKS)[number]["id"];

export type NotificationRelatedLink = {
  id: NotificationRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — What’s new · Support · Account · prefs. */
export const NOTIFICATION_RELATED_INCLUDE: NotificationRelatedId[] = [
  "whats-new",
  "support",
  "account",
  "preferences",
];

/** Cross-links for Notifications Soft-UI (never DEMO inbox rows). */
export function notificationRelatedLinks(options?: {
  active?: NotificationRelatedId;
  include?: NotificationRelatedId[];
}): NotificationRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return NOTIFICATION_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({ id: link.id, label: link.label, href: link.href }));
}

export type NotificationNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for the inbox.
 * Empty stays empty until a real notifications row exists — never DEMO alerts.
 */
export function notificationNextActions(input: {
  itemCount: number;
  unreadCount: number;
  filter?: "all" | "unread";
}): NotificationNextAction[] {
  const filter = input.filter ?? "all";
  const actions: NotificationNextAction[] = [];

  if (input.itemCount === 0 && filter === "unread") {
    actions.push({
      id: "caught-up",
      label: "You’re caught up",
      detail: "No unread rows — switch to All to review history, or leave the inbox clear.",
      href: "/notifications",
      primary: true,
    });
  } else if (input.itemCount === 0) {
    actions.push({
      id: "empty",
      label: "Inbox stays empty until something real arrives",
      detail:
        "Coach todos, duties, calendar events, releases, and teammate messages land here with real timestamps — nothing is pre-seeded.",
      href: "/notifications/preferences",
      primary: true,
    });
  } else if (input.unreadCount > 0) {
    actions.push({
      id: "mark-read",
      label: `Mark ${input.unreadCount} as read`,
      detail: "Unread rows stay highlighted until you open them or mark them read — clears only real inbox items.",
      href: "#notif-inbox-list",
      primary: true,
    });
  } else {
    actions.push({
      id: "clear",
      label: "Inbox clear",
      detail: "Everything shown is marked read. New real events will bump the unread badge again.",
      href: "/notifications?filter=unread",
      primary: true,
    });
  }

  actions.push(
    {
      id: "preferences",
      label: "Tune what notifies",
      detail: "Choose which coach→member and product events may land in this inbox.",
      href: "/notifications/preferences",
      primary: false,
    },
    {
      id: "whats-new",
      label: "What’s new",
      detail: "Published release notes for your plan — separate from invented competition notices.",
      href: "/whats-new",
    },
    {
      id: "support",
      label: "Help & Support",
      detail: "Open a real platform ticket if an alert never arrived or looks wrong.",
      href: "/support",
    },
    {
      id: "account",
      label: "Account",
      detail: "Profile, appearance, and a shortcut into notification prefs.",
      href: "/account?tab=notifications",
    },
  );

  return actions.slice(0, 5);
}

/** Soft-UI read-state label — blank-safe, never a DEMO status. */
export function notificationReadLabel(readAt: string | null | undefined): "Unread" | "Read" {
  return readAt ? "Read" : "Unread";
}

/** Soft-UI badge tone for read state. */
export function notificationReadTone(readAt: string | null | undefined): "setup" | "good" | "" {
  if (!readAt) return "setup";
  return "good";
}
