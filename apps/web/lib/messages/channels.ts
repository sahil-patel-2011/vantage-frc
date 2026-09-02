/**
 * Pure helpers for team-chat channels (no DB). Migration 0494_chat_channels.sql owns the shape;
 * apps/web/lib/messages/channels-db.ts owns the queries; this file owns the rules so they are
 * testable without a database:
 *
 *   - slugs: "#general", "#build-season" ...
 *   - who may post where (announce = mentors/admins, archived = nobody, subteam = members)
 *   - message edit window (15 minutes for students, unlimited for mentors/admins)
 *   - unread arithmetic used by the rail badges
 *   - which channels the outbound Slack/Discord bridges mirror
 */

export const CHANNEL_KINDS = ["team", "announce", "subteam"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];
export type ConversationKind = ChannelKind | "dm";

export const GENERAL_SLUG = "general";
export const MAX_CHANNEL_TITLE = 60;
export const MAX_CHANNEL_DESCRIPTION = 280;
export const MAX_SLUG = 40;

/** Students may fix a typo; they may not rewrite history. Mentors/admins are not time-limited. */
export const STUDENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (CHANNEL_KINDS as readonly string[]).includes(value);
}

/** Kind for a new channel. Anything unrecognised is an ordinary open channel. */
export function normalizeChannelKind(raw: unknown): ChannelKind {
  return isChannelKind(raw) ? raw : "team";
}

export function normalizeChannelTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!title) throw new Error("Give the channel a name");
  if (title.length > MAX_CHANNEL_TITLE) {
    throw new Error(`Channel names are ${MAX_CHANNEL_TITLE} characters or fewer`);
  }
  return title;
}

export function normalizeChannelDescription(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  return text.slice(0, MAX_CHANNEL_DESCRIPTION);
}

/** "Build Season 2026!" -> "build-season-2026". Never empty, never longer than MAX_SLUG. */
export function slugifyChannelTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, "");
  return base || "channel";
}

/** Append -2, -3 ... until the slug is free within the org. Keeps the result within MAX_SLUG. */
export function uniqueChannelSlug(base: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const slug of taken) used.add(slug.toLowerCase());
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Could not find a free channel name");
}

export type PostGate = { ok: true } | { ok: false; reason: string };

/**
 * May this member write into this conversation right now?
 *  - DMs: yes (the youth-protection guard runs separately on the send path).
 *  - archived: never.
 *  - announce: only announcers (owner/admin org role, mentor/coach team role).
 *  - subteam: channel members only.
 *  - team (#general and other open channels): any org member; the route auto-joins them.
 */
export function canPostToChannel(input: {
  kind: ConversationKind;
  archived: boolean;
  isMember: boolean;
  canAnnounce: boolean;
}): PostGate {
  if (input.kind === "dm") return { ok: true };
  if (input.archived) return { ok: false, reason: "This channel is archived and no longer accepts messages" };
  if (input.kind === "announce") {
    return input.canAnnounce
      ? { ok: true }
      : { ok: false, reason: "Only mentors and team admins can post in an announcement channel" };
  }
  if (input.kind === "subteam") {
    return input.isMember ? { ok: true } : { ok: false, reason: "Join this channel to post in it" };
  }
  return { ok: true };
}

/** Archive / edit a channel: announcers, the channel's moderators, or whoever created it. */
export function canManageChannel(input: {
  canAnnounce: boolean;
  memberRole: string | null | undefined;
  isCreator: boolean;
}): boolean {
  return input.canAnnounce || input.memberRole === "moderator" || input.isCreator;
}

export function canLeaveChannel(input: { kind: ConversationKind; slug: string | null }): PostGate {
  if (input.kind === "dm") return { ok: false, reason: "Private conversations cannot be left" };
  if (input.slug === GENERAL_SLUG) return { ok: false, reason: "Everyone on the team is in #general" };
  return { ok: true };
}

export function canEditMessage(input: {
  authorUserId: string;
  actorUserId: string;
  createdAt: string | Date;
  deleted: boolean;
  /** Owner/admin org role or an adult team role: no time limit. */
  unlimited: boolean;
  now?: number;
}): PostGate {
  if (input.authorUserId !== input.actorUserId) {
    return { ok: false, reason: "You can only edit your own messages" };
  }
  if (input.deleted) return { ok: false, reason: "Deleted messages cannot be edited" };
  if (input.unlimited) return { ok: true };
  const created = new Date(input.createdAt).getTime();
  const now = input.now ?? Date.now();
  if (!Number.isFinite(created) || now - created > STUDENT_EDIT_WINDOW_MS) {
    return { ok: false, reason: "Messages can be edited for 15 minutes after they are sent" };
  }
  return { ok: true };
}

/** The revision row an edit should write, or null when nothing actually changed. */
export function revisionForEdit(
  priorBody: string,
  nextBody: string,
): { action: "edit"; priorBody: string } | null {
  if (priorBody === nextBody) return null;
  return { action: "edit", priorBody };
}

export type UnreadMessage = {
  createdAt: string;
  authorUserId: string;
  deletedAt?: string | null;
};

/**
 * Reference semantics for the SQL unread count: live messages by someone else, newer than the
 * viewer's read cursor (no cursor = everything counts). Used by the tests to pin the rule and by
 * the client for optimistic badge updates.
 */
export function countUnread(messages: UnreadMessage[], lastReadAt: string | null, viewerId: string): number {
  let count = 0;
  for (const message of messages) {
    if (message.deletedAt) continue;
    if (message.authorUserId === viewerId) continue;
    if (lastReadAt && message.createdAt <= lastReadAt) continue;
    count += 1;
  }
  return count;
}

export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export type RailConversation = {
  kind: ConversationKind;
  slug?: string | null;
  archivedAt?: string | null;
};

export type RailGroups<T extends RailConversation> = {
  general: T | null;
  open: T[];
  announce: T[];
  subteam: T[];
  archived: T[];
  dms: T[];
};

/** Rail order: #general, announcements, subteams, other open channels, DMs, archived last. */
export function groupConversations<T extends RailConversation>(list: T[]): RailGroups<T> {
  const groups: RailGroups<T> = { general: null, open: [], announce: [], subteam: [], archived: [], dms: [] };
  for (const item of list) {
    if (item.kind === "dm") {
      groups.dms.push(item);
      continue;
    }
    if (item.archivedAt) {
      groups.archived.push(item);
      continue;
    }
    if (item.slug === GENERAL_SLUG && !groups.general) {
      groups.general = item;
      continue;
    }
    if (item.kind === "announce") groups.announce.push(item);
    else if (item.kind === "subteam") groups.subteam.push(item);
    else groups.open.push(item);
  }
  return groups;
}

/**
 * Outbound Slack/Discord mirroring: announcement channels are what a bridge should carry. A team
 * that has not created one yet keeps the pre-channels behaviour (mirror #general) so an existing
 * bridge does not go silent the moment this ships.
 */
export function shouldMirrorOutbound(input: {
  kind: ConversationKind;
  slug: string | null;
  orgHasAnnounceChannel: boolean;
}): boolean {
  if (input.kind === "announce") return true;
  if (input.kind === "team" && input.slug === GENERAL_SLUG) return !input.orgHasAnnounceChannel;
  return false;
}

/** Newest live message across the inbox: the long-poll's "did anything else move?" watermark. */
export function inboxWatermark(
  conversations: Array<{ lastMessageAt: string | null }>,
  previous: string | null,
): string | null {
  let max = previous;
  for (const item of conversations) {
    if (item.lastMessageAt && (!max || item.lastMessageAt > max)) max = item.lastMessageAt;
  }
  return max;
}

export function channelLabel(item: { kind: ConversationKind; slug?: string | null; title?: string | null }): string {
  if (item.kind === "dm") return item.title ?? "Private chat";
  if (item.slug) return `#${item.slug}`;
  return item.title ? `#${slugifyChannelTitle(item.title)}` : "#channel";
}
