/** Related surfaces for the account inbox. */
export const NOTIFICATION_RELATED_LINKS = [
  { id: "whats-new", label: "What’s new", href: "/whats-new" },
  { id: "support", label: "Help & Support", href: "/support" },
  { id: "account", label: "Account", href: "/account" },
  { id: "preferences", label: "Preferences", href: "/notifications/preferences" },
] as const;

export type NotificationRelatedId = (typeof NOTIFICATION_RELATED_LINKS)[number]["id"];

export type NotificationRelatedLink = {
  id: NotificationRelatedId;
  label: string;
  href: string;
};

/** Header strip — What’s new · Support · Account · Preferences. */
export const NOTIFICATION_RELATED_INCLUDE: NotificationRelatedId[] = [
  "whats-new",
  "support",
  "account",
  "preferences",
];

/** Cross-links for the inbox header. */
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
 * Inbox next actions. Empty keeps one EmptyState primary; related stays in
 * the header. Mark-as-read lives in the toolbar, so this list is empty unless
 * a caller still needs the unread count as a single primary.
 */
export function notificationNextActions(input: {
  itemCount: number;
  unreadCount: number;
  filter?: "all" | "unread";
}): NotificationNextAction[] {
  if (input.itemCount === 0) return [];
  if (input.unreadCount < 1) return [];
  return [
    {
      id: "mark-read",
      label: `Mark ${input.unreadCount} as read`,
      detail: "Unread rows stay highlighted until you open them or mark them read.",
      href: "#notif-inbox-list",
      primary: true,
    },
  ];
}

/** Read-state label — blank-safe. */
export function notificationReadLabel(readAt: string | null | undefined): "Unread" | "Read" {
  return readAt ? "Read" : "Unread";
}

/** Badge tone for read state. */
export function notificationReadTone(readAt: string | null | undefined): "setup" | "good" | "" {
  if (!readAt) return "setup";
  return "good";
}
