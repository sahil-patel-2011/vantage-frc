import type { MediaContentItem } from "./types";

/**
 * Pure caption/due suggestion from title + platform + notes.
 * Never invents DEMO engagement metrics — empty when no usable input.
 */
export function buildMediaPostDraft(input: {
  title?: string | null;
  platform?: string | null;
  notes?: string | null;
  now?: Date;
}): { caption: string; dueAt: string | null } | null {
  const title = (input.title ?? "").trim();
  const notes = (input.notes ?? "").trim();
  const platform = (input.platform ?? "other").trim() || "other";
  if (!title && !notes) return null;

  const subject = title || notes.slice(0, 80);
  const platformLabel =
    platform === "x"
      ? "X"
      : platform === "other"
        ? "social"
        : platform.charAt(0).toUpperCase() + platform.slice(1);

  const lines = [
    subject,
    notes && notes !== title ? notes.slice(0, 500) : null,
    `Shared on ${platformLabel} — recorded in Vantage Media (no invented reach).`,
  ].filter(Boolean) as string[];

  const due = input.now ?? new Date();
  let dueAt: string | null = null;
  if (title) {
    const suggested = new Date(due);
    suggested.setUTCDate(suggested.getUTCDate() + 1);
    suggested.setUTCHours(18, 0, 0, 0);
    dueAt = suggested.toISOString();
  }

  return { caption: lines.join("\n\n").slice(0, 4000), dueAt };
}

/** Calendar: scheduled / due posts that are not cancelled. */
export function mediaCalendarItems(items: MediaContentItem[]): MediaContentItem[] {
  return items
    .filter((item) => {
      if (item.status === "cancelled" || item.status === "posted") return false;
      return item.status === "scheduled" || Boolean(item.dueAt);
    })
    .sort((a, b) => {
      const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
}

/** Drafts tab: draft status items. */
export function mediaDraftItems(items: MediaContentItem[]): MediaContentItem[] {
  return items.filter((item) => item.status === "draft");
}

/** Reminders: upcoming or overdue remind_at that have not been dismissed. */
export function mediaReminderItems(items: MediaContentItem[]): MediaContentItem[] {
  return items
    .filter(
      (item) =>
        item.remindAt &&
        !item.remindedAt &&
        (item.status === "draft" || item.status === "scheduled"),
    )
    .sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!));
}

export function isMediaReminderOverdue(item: MediaContentItem, now = new Date()): boolean {
  if (!item.remindAt || item.remindedAt) return false;
  return Date.parse(item.remindAt) <= now.getTime();
}
