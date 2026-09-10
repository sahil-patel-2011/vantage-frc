import { OBJECT_TYPE_OPTIONS, type MessageObjectLink } from "../../lib/messages/object-links";
import { findMentionedUserIds, type MentionRef } from "../../lib/messages/mentions";

export type Conversation = {
  id: string;
  kind: "team" | "dm";
  title: string | null;
  updatedAt: string;
  lastMessageAt: string | null;
  lastBody: string | null;
  peerUserId: string | null;
  peerName: string | null;
  unreadCount: number;
  archivedAt?: string | null;
  isDefaultChannel?: boolean;
};

export type Message = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  authorUserId: string;
  authorName: string;
  deletedAt: string | null;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  mine: boolean;
  mentions?: MentionRef[];
  objectLink?: MessageObjectLink | null;
};

export type LinkTarget = MessageObjectLink & { subtitle?: string | null };

export type Member = { id: string; name: string; email: string; role: string };

export type ChannelDraft = { mode: "create" | "rename"; value: string };

export function objectTypeLabel(objectType: MessageObjectLink["objectType"]) {
  return OBJECT_TYPE_OPTIONS.find((option) => option.value === objectType)?.label ?? objectType;
}

export function mentionsForRender(body: string, mentions: MentionRef[] | undefined, members: Member[]): MentionRef[] {
  if (mentions?.length) return mentions;
  const ids = new Set(findMentionedUserIds(body, members));
  return members
    .filter((member) => ids.has(member.id))
    .map((member) => ({ userId: member.id, name: member.name }));
}

export function labelFor(conversation: Conversation) {
  if (conversation.kind === "team") return conversation.title ?? "Team";
  return conversation.peerName ?? "Private chat";
}

export function isArchived(conversation: Conversation) {
  return Boolean(conversation.archivedAt);
}

export function formatTime(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}
