"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  applyMention,
  filterMembersForMention,
  findActiveMention,
  findMentionedUserIds,
  pruneMentionIds,
  segmentMessageBody,
  type MentionMember,
  type MentionRef,
} from "../../lib/messages/mentions";
import {
  COMPOSER_OBJECT_TYPES,
  OBJECT_TYPE_OPTIONS,
  type MessageObjectLink,
} from "../../lib/messages/object-links";
import { earliestCursor, prependEarlier } from "../../lib/messages/history";
import {
  LONG_POLL_MAX_MS,
  mergeMessages,
  nextWatermark,
  pollBackoffMs,
  totalUnread,
} from "../../lib/messages/sync";
import {
  canEditMessage,
  canManageChannel,
  channelLabel,
  GENERAL_SLUG,
  groupConversations,
  inboxWatermark,
  slugifyChannelTitle,
  unreadBadge,
  type ChannelKind,
  type ConversationKind,
} from "../../lib/messages/channels";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import ChatSafetyPanel from "./chat-safety-panel";
import "./youth-protection.css";
import "./messages.css";

type Conversation = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  slug?: string | null;
  description?: string | null;
  subteamId?: string | null;
  archivedAt?: string | null;
  createdBy?: string | null;
  updatedAt: string;
  lastMessageAt: string | null;
  lastBody: string | null;
  peerUserId: string | null;
  peerName: string | null;
  unreadCount: number;
  isMember?: boolean;
  memberRole?: string | null;
  canPost?: boolean;
};

type Message = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  editedAt?: string | null;
  authorUserId: string;
  authorName: string;
  deletedAt: string | null;
  pinnedAt?: string | null;
  pinnedBy?: string | null;
  mine: boolean;
  mentions?: MentionRef[];
  objectLink?: MessageObjectLink | null;
};

type ChannelPermissions = {
  channelsSupported: boolean;
  canAnnounce: boolean;
  canCreate: boolean;
  unlimitedEdit: boolean;
};

type Subteam = { id: string; name: string };

type LinkTarget = MessageObjectLink & { subtitle?: string | null };

function objectTypeLabel(objectType: MessageObjectLink["objectType"]) {
  return OBJECT_TYPE_OPTIONS.find((option) => option.value === objectType)?.label ?? objectType;
}

type Member = { id: string; name: string; email: string; role: string };

function mentionsForRender(body: string, mentions: MentionRef[] | undefined, members: Member[]): MentionRef[] {
  if (mentions?.length) return mentions;
  const ids = new Set(findMentionedUserIds(body, members));
  return members
    .filter((member) => ids.has(member.id))
    .map((member) => ({ userId: member.id, name: member.name }));
}

function MessageBody({
  body,
  mentions = [],
  members,
}: {
  body: string;
  mentions?: MentionRef[];
  members: Member[];
}) {
  const segments = segmentMessageBody(body, mentionsForRender(body, mentions, members));
  return (
    <p>
      {segments.map((segment, index) =>
        segment.kind === "mention" ? (
          <span key={`${segment.userId}-${index}`} className="message-mention">
            {segment.value}
          </span>
        ) : (
          <span key={`t-${index}`}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

function isChannel(item: Conversation | null | undefined): boolean {
  return Boolean(item && item.kind !== "dm");
}

function labelFor(conversation: Conversation) {
  if (conversation.kind === "dm") return conversation.peerName ?? "Private chat";
  return channelLabel({ kind: conversation.kind, slug: conversation.slug ?? null, title: conversation.title });
}

function kindEyebrow(conversation: Conversation) {
  if (conversation.kind === "dm") return "Private chat";
  if (conversation.kind === "announce") return "Announcements";
  if (conversation.kind === "subteam") return "Subteam channel";
  return conversation.slug === GENERAL_SLUG ? "Team channel" : "Channel";
}

function formatTime(value: string | null | undefined) {
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

function waitUntilVisible(signal: AbortSignal) {
  if (!document.hidden) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onVisibility = () => {
      if (!document.hidden) {
        document.removeEventListener("visibilitychange", onVisibility);
        signal.removeEventListener("abort", onAbort);
        resolve();
      }
    };
    const onAbort = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    document.addEventListener("visibilitychange", onVisibility);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function postAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  return { ok: response.ok, data };
}

function RailItem({
  item,
  active,
  onSelect,
}: {
  item: Conversation;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const badge = unreadBadge(item.unreadCount);
  const notMember = isChannel(item) && item.isMember === false;
  const icon =
    item.kind === "announce" ? "🔒" : item.kind === "dm" ? "@" : notMember ? "○" : "#";
  const label =
    item.kind === "dm"
      ? item.peerName ?? "Private chat"
      : (item.slug ?? slugifyChannelTitle(item.title ?? "channel"));
  return (
    <button
      type="button"
      className={`rail-item${active ? " active" : ""}${badge ? " has-unread" : ""}${notMember ? " not-member" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(item.id)}
      title={item.description ?? item.title ?? undefined}
    >
      <span className="rail-label">
        <span className="rail-icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </span>
      {item.lastBody ? <small className="rail-preview">{item.lastBody}</small> : null}
      {badge ? (
        <b className="rail-badge" aria-label={`${item.unreadCount} unread`}>
          {badge}
        </b>
      ) : null}
    </button>
  );
}

export default function MessagesClient({
  orgId,
  embedded = false,
  initialConversationId = null,
  initialObjectLink = null,
}: {
  orgId: string;
  /** When true (Team hub tab), hide PageHeader / related strips — hub chrome already covers them. */
  embedded?: boolean;
  initialConversationId?: string | null;
  initialObjectLink?: MessageObjectLink | null;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ChannelPermissions>({
    channelsSupported: false,
    canAnnounce: false,
    canCreate: false,
    unlimitedEdit: false,
  });
  const [subteams, setSubteams] = useState<Subteam[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [pinsSupported, setPinsSupported] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [composerCursor, setComposerCursor] = useState(0);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(true);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingObjectLink, setPendingObjectLink] = useState<MessageObjectLink | null>(initialObjectLink);
  const [linkPickerOpen, setLinkPickerOpen] = useState(Boolean(initialObjectLink));
  const [linkPickerType, setLinkPickerType] = useState<MessageObjectLink["objectType"]>(
    initialObjectLink?.objectType ?? COMPOSER_OBJECT_TYPES[0]!,
  );
  const [linkQuery, setLinkQuery] = useState("");
  const [linkTargets, setLinkTargets] = useState<LinkTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  // Youth protection: who else is in this private chat, and why. Deliberately not dismissible —
  // both parties must be able to see the second adult for the whole time the room exists.
  const [supervisionNotice, setSupervisionNotice] = useState("");
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [live, setLive] = useState(true);
  // Mobile (<768px): the rail and the thread are one column; this decides which is showing.
  const [mobileView, setMobileView] = useState<"list" | "thread">(initialConversationId ? "thread" : "list");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newKind, setNewKind] = useState<ChannelKind>("team");
  const [newSubteamId, setNewSubteamId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // Set just before an older page is prepended so the scroll position can be
  // restored relative to the previously-visible messages.
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sinceRef = useRef<string | null>(null);
  // Newest lastMessageAt across the inbox; lets the server wake the long poll for rail badges.
  const inboxSinceRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const stickToBottomRef = useRef(true);
  const membersLoadedRef = useRef(false);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const activeIsChannel = isChannel(active);
  const inboxUnread = totalUnread(conversations);
  const groups = groupConversations(conversations);
  const activeMention =
    activeIsChannel && mentionMenuOpen ? findActiveMention(text, composerCursor) : null;
  const mentionSuggestions = activeMention
    ? filterMembersForMention(members, activeMention.query)
    : [];
  const selectedMentions = mentionedUserIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member));
  const canPostHere = active ? active.canPost !== false : false;
  const canManageActive =
    Boolean(active) &&
    activeIsChannel &&
    active!.slug !== GENERAL_SLUG &&
    permissions.channelsSupported &&
    canManageChannel({
      canAnnounce: permissions.canAnnounce,
      memberRole: active!.memberRole ?? null,
      isCreator: Boolean(currentUserId && active!.createdBy === currentUserId),
    });

  useEffect(() => {
    if (initialObjectLink) {
      setPendingObjectLink(initialObjectLink);
      setLinkPickerOpen(true);
      setLinkPickerType(initialObjectLink.objectType);
    }
  }, [initialObjectLink]);

  const loadLinkTargets = useCallback(
    async (objectType: MessageObjectLink["objectType"], query: string) => {
      const params = new URLSearchParams({
        orgId,
        mode: "link_targets",
        linkType: objectType,
        q: query,
      });
      const response = await fetch(`/api/messages?${params}`);
      const data = await response.json();
      if (!response.ok) {
        setLinkTargets([]);
        return;
      }
      setLinkTargets((data.targets ?? []) as LinkTarget[]);
    },
    [orgId],
  );

  useEffect(() => {
    if (!linkPickerOpen || !activeIsChannel) return;
    const timer = window.setTimeout(() => {
      void loadLinkTargets(linkPickerType, linkQuery);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeIsChannel, linkPickerOpen, linkPickerType, linkQuery, loadLinkTargets]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const scrollToBottom = useCallback(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  /** Apply any response that carries inbox state; every key is optional so a delta cannot reset UI. */
  const applySnapshot = useCallback((data: Record<string, unknown>) => {
    if (Array.isArray(data.conversations)) {
      const list = data.conversations as Conversation[];
      setConversations(list);
      inboxSinceRef.current = inboxWatermark(list, inboxSinceRef.current);
    }
    if (typeof data.currentUserId === "string") setCurrentUserId(data.currentUserId);
    if (data.channelPermissions && typeof data.channelPermissions === "object") {
      const next = data.channelPermissions as Partial<ChannelPermissions>;
      setPermissions({
        channelsSupported: Boolean(next.channelsSupported),
        canAnnounce: Boolean(next.canAnnounce),
        canCreate: Boolean(next.canCreate),
        unlimitedEdit: Boolean(next.unlimitedEdit),
      });
    }
    if (Array.isArray(data.subteams)) setSubteams(data.subteams as Subteam[]);
    if (typeof data.pinsSupported === "boolean") setPinsSupported(data.pinsSupported);
  }, []);

  const loadInbox = useCallback(async () => {
    const response = await fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      const message = data.error || "Could not load conversations.";
      setLoadError(message);
      setLoadErrorStatus(response.status);
      setStatus(message);
      return null;
    }
    setLoadError(null);
    setLoadErrorStatus(null);
    applySnapshot(data);
    return (data.conversations ?? []) as Conversation[];
  }, [applySnapshot, orgId]);

  const loadThread = useCallback(
    async (
      conversationId: string,
      opts?: { quiet?: boolean; since?: string | null; wait?: number },
    ) => {
      const params = new URLSearchParams({ orgId, conversationId });
      if (opts?.since) params.set("since", opts.since);
      if (opts?.wait && opts.wait > 0) {
        params.set("wait", String(opts.wait));
        if (inboxSinceRef.current) params.set("inboxSince", inboxSinceRef.current);
      }
      const response = await fetch(`/api/messages?${params}`, {
        signal: AbortSignal.timeout((opts?.wait ?? 0) + 12000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (!opts?.quiet) setStatus(data.error || "Could not load messages.");
        throw new Error(data.error || "Could not load messages.");
      }
      applySnapshot(data);
      // Refreshed on every poll, not just the initial load: a supervisor added to an existing
      // thread (policy tightened after the fact) has to show up without a manual reload.
      if (Array.isArray(data.supervisors)) {
        setSupervisionNotice(String(data.supervisionNotice ?? ""));
      }

      const incoming = (data.messages ?? []) as Message[];
      if (opts?.since) {
        if (incoming.length) {
          setMessages((prev) => {
            const next = mergeMessages(prev, incoming);
            sinceRef.current = nextWatermark(incoming, sinceRef.current);
            return next;
          });
          setPinned((prev) => {
            const byId = new Map(prev.map((item) => [item.id, item]));
            for (const item of incoming) {
              if (item.deletedAt || !item.pinnedAt) byId.delete(item.id);
              else byId.set(item.id, item);
            }
            return [...byId.values()].sort((a, b) =>
              String(b.pinnedAt ?? "").localeCompare(String(a.pinnedAt ?? "")),
            );
          });
        }
      } else {
        setMessages(incoming);
        setPinned((data.pinned ?? []) as Message[]);
        setHasEarlier(Boolean(data.hasEarlier));
        sinceRef.current = nextWatermark(incoming, null);
      }
      return incoming.length > 0;
    },
    [applySnapshot, orgId],
  );

  async function reloadMessages() {
    setLoading(true);
    setLoadError(null);
    setLoadErrorStatus(null);
    setStatus("");
    const list = await loadInbox();
    const preferred =
      (activeId && list?.find((item) => item.id === activeId)) ||
      (initialConversationId && list?.find((item) => item.id === initialConversationId)) ||
      list?.find((item) => item.kind === "team") ||
      list?.[0] ||
      null;
    if (preferred) {
      setActiveId(preferred.id);
      await loadThread(preferred.id);
    } else {
      setActiveId(null);
      setMessages([]);
      setPinned([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await loadInbox();
      if (cancelled) return;
      const preferred =
        (initialConversationId && list?.find((item) => item.id === initialConversationId)) ||
        list?.find((item) => item.kind === "team" && item.slug === GENERAL_SLUG) ||
        list?.find((item) => item.kind === "team") ||
        list?.[0] ||
        null;
      if (preferred) {
        setActiveId(preferred.id);
        await loadThread(preferred.id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialConversationId, loadInbox, loadThread]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    let failures = 0;

    (async () => {
      while (!controller.signal.aborted) {
        if (document.hidden) {
          setLive(false);
          await waitUntilVisible(controller.signal);
          if (controller.signal.aborted) break;
          setLive(true);
        }

        try {
          const changed = await loadThread(activeId, {
            quiet: true,
            since: sinceRef.current,
            wait: LONG_POLL_MAX_MS,
          });
          failures = 0;
          setLive(true);
          if (!changed && activeIdRef.current === activeId) {
            continue;
          }
        } catch {
          failures += 1;
          setLive(false);
          await sleep(pollBackoffMs(failures), controller.signal);
        }
      }
    })();

    return () => controller.abort();
  }, [activeId, loadThread]);

  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (anchor) {
      // An older page was just prepended: keep the previously-visible
      // messages where they were instead of snapping to the bottom.
      scrollAnchorRef.current = null;
      const node = messagesRef.current;
      if (node) node.scrollTop = node.scrollHeight - anchor.height + anchor.top;
      return;
    }
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadEarlier = useCallback(async () => {
    if (!activeId || loadingEarlier) return;
    const cursor = earliestCursor(messages);
    if (!cursor) return;
    setLoadingEarlier(true);
    try {
      const params = new URLSearchParams({
        orgId,
        conversationId: activeId,
        before: cursor.before,
        beforeId: cursor.beforeId,
      });
      const response = await fetch(`/api/messages?${params}`, {
        signal: AbortSignal.timeout(12000),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not load earlier messages.");
        return;
      }
      if (activeIdRef.current !== activeId) return;
      const earlier = (data.messages ?? []) as Message[];
      stickToBottomRef.current = false;
      const node = messagesRef.current;
      scrollAnchorRef.current = node ? { height: node.scrollHeight, top: node.scrollTop } : null;
      setMessages((prev) => prependEarlier(prev, earlier));
      setHasEarlier(Boolean(data.hasEarlier));
    } catch {
      setStatus("Could not load earlier messages.");
    } finally {
      setLoadingEarlier(false);
    }
  }, [activeId, loadingEarlier, messages, orgId]);

  const ensureMembers = useCallback(async () => {
    if (membersLoadedRef.current && members.length > 0) return members;
    const response = await fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}&mode=members`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not load members.");
      return [];
    }
    const list = (data.members ?? []) as Member[];
    setMembers(list);
    membersLoadedRef.current = true;
    return list;
  }, [members.length, orgId]);

  useEffect(() => {
    if (activeIsChannel) {
      void ensureMembers();
    }
  }, [activeIsChannel, ensureMembers]);

  useEffect(() => {
    const activeAt = findActiveMention(text, composerCursor);
    if (!activeAt) {
      setMentionMenuOpen(true);
      setMentionIndex(0);
      return;
    }
    setMentionIndex(0);
  }, [text, composerCursor]);

  async function selectConversation(id: string) {
    setActiveId(id);
    setPickerOpen(false);
    setSafetyOpen(false);
    setStatus("");
    setHasEarlier(false);
    setEditingId(null);
    setMobileView("thread");
    // Clear the previous thread's banner so it can never be shown against the wrong room.
    setSupervisionNotice("");
    sinceRef.current = null;
    stickToBottomRef.current = true;
    const url = new URL(window.location.href);
    url.searchParams.set("conversationId", id);
    window.history.replaceState({}, "", url.toString());
    await loadThread(id);
  }

  async function openMemberPicker() {
    setPickerOpen(true);
    await ensureMembers();
  }

  function updateComposer(nextText: string, cursor: number, nextMentionIds?: string[]) {
    const refs = members.map((member) => ({ userId: member.id, name: member.name }));
    const ids = pruneMentionIds(nextText, refs, nextMentionIds ?? mentionedUserIds);
    setText(nextText);
    setComposerCursor(cursor);
    setMentionedUserIds(ids);
  }

  function selectMention(member: MentionMember) {
    const result = applyMention(text, composerCursor, member);
    const nextIds = mentionedUserIds.includes(member.id)
      ? mentionedUserIds
      : [...mentionedUserIds, member.id];
    updateComposer(result.text, result.cursor, nextIds);
    requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!activeMention || mentionSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((index) => (index + 1) % mentionSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((index) => (index - 1 + mentionSuggestions.length) % mentionSuggestions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const chosen = mentionSuggestions[mentionIndex] ?? mentionSuggestions[0];
      if (chosen) selectMention(chosen);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionMenuOpen(false);
    }
  }

  async function startDm(peerUserId: string) {
    setSending(true);
    setStatus("");
    try {
      const { ok, data } = await postAction({ action: "open_dm", orgId, peerUserId });
      if (!ok) {
        setStatus(data.error || "Could not open private chat.");
        return;
      }
      await loadInbox();
      await selectConversation(data.conversationId);
    } finally {
      setSending(false);
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !text.trim() || sending) return;
    if (activeMention && mentionSuggestions.length > 0) return;
    setSending(true);
    setStatus("");
    try {
      const { ok, data } = await postAction({
        action: "send",
        orgId,
        conversationId: activeId,
        body: text,
        mentionedUserIds: activeIsChannel ? mentionedUserIds : [],
        objectLink: activeIsChannel ? pendingObjectLink : undefined,
      });
      if (!ok) {
        setStatus(data.error || "Could not send message.");
        return;
      }
      setText("");
      setMentionedUserIds([]);
      setPendingObjectLink(null);
      setLinkPickerOpen(false);
      setLinkQuery("");
      setComposerCursor(0);
      stickToBottomRef.current = true;
      sinceRef.current = null;
      await loadThread(activeId);
    } finally {
      setSending(false);
    }
  }

  async function softDelete(messageId: string) {
    if (!confirm("Delete this message for everyone in the conversation?")) return;
    const { ok, data } = await postAction({ action: "soft_delete", orgId, messageId });
    if (!ok) {
      setStatus(data.error || "Could not delete message.");
      return;
    }
    setMessages((prev) =>
      prev.map((item) =>
        item.id === messageId
          ? { ...item, body: "", deletedAt: new Date().toISOString(), pinnedAt: null }
          : item,
      ),
    );
    setPinned((prev) => prev.filter((item) => item.id !== messageId));
  }

  function startEdit(message: Message) {
    setEditingId(message.id);
    setEditText(message.body);
    setStatus("");
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId || savingEdit) return;
    const messageId = editingId;
    setSavingEdit(true);
    try {
      const { ok, data } = await postAction({ action: "edit", orgId, messageId, body: editText });
      if (!ok) {
        setStatus(data.error || "Could not edit message.");
        return;
      }
      const edited = data.message as { body: string; editedAt: string | null; updatedAt?: string } | undefined;
      if (edited) {
        const patch = (item: Message) =>
          item.id === messageId
            ? { ...item, body: edited.body, editedAt: edited.editedAt, updatedAt: edited.updatedAt ?? item.updatedAt }
            : item;
        setMessages((prev) => prev.map(patch));
        setPinned((prev) => prev.map(patch));
        if (edited.updatedAt) sinceRef.current = nextWatermark([{ ...edited, id: messageId, createdAt: "" }], sinceRef.current);
      }
      setEditingId(null);
      setEditText("");
    } finally {
      setSavingEdit(false);
    }
  }

  async function togglePin(message: Message) {
    if (!pinsSupported || !active || !activeIsChannel) return;
    const action = message.pinnedAt ? "unpin" : "pin";
    const { ok, data } = await postAction({ action, orgId, messageId: message.id });
    if (!ok) {
      setStatus(data.error || `Could not ${action} message.`);
      return;
    }
    if (activeId) {
      sinceRef.current = null;
      await loadThread(activeId);
    }
  }

  async function channelAction(action: "join_channel" | "leave_channel" | "archive_channel", conversationId: string) {
    if (action === "archive_channel" && !confirm("Archive this channel? It becomes read-only for everyone.")) return;
    if (action === "leave_channel" && !confirm("Leave this channel? You can rejoin from the rail any time.")) return;
    setStatus("");
    const { ok, data } = await postAction({ action, orgId, conversationId });
    if (!ok) {
      setStatus(data.error || "Could not update channel.");
      return;
    }
    applySnapshot(data);
    if (action === "leave_channel" && activeId === conversationId) {
      const general = (data.conversations as Conversation[] | undefined)?.find(
        (item) => item.kind === "team" && item.slug === GENERAL_SLUG,
      );
      if (general) await selectConversation(general.id);
    }
  }

  function openChannelDialog() {
    setNewTitle("");
    setNewKind("team");
    setNewSubteamId("");
    setNewDescription("");
    setDialogError("");
    setChannelDialogOpen(true);
    if (subteams.length === 0) {
      void fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}&mode=channels`)
        .then((response) => response.json())
        .then((data) => applySnapshot(data))
        .catch(() => undefined);
    }
  }

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setDialogError("");
    try {
      const { ok, data } = await postAction({
        action: "create_channel",
        orgId,
        title: newTitle,
        kind: newKind,
        subteamId: newKind === "subteam" ? newSubteamId || undefined : undefined,
        description: newDescription,
      });
      if (!ok) {
        setDialogError(data.error || "Could not create channel.");
        return;
      }
      applySnapshot(data);
      setChannelDialogOpen(false);
      if (typeof data.conversationId === "string") await selectConversation(data.conversationId);
    } finally {
      setCreating(false);
    }
  }

  function canEdit(item: Message): boolean {
    if (!permissions.channelsSupported || !item.mine || item.deletedAt || !currentUserId) return false;
    return canEditMessage({
      authorUserId: item.authorUserId,
      actorUserId: currentUserId,
      createdAt: item.createdAt,
      deleted: Boolean(item.deletedAt),
      unlimited: permissions.unlimitedEdit,
    }).ok;
  }

  function renderGroup(title: string, items: Conversation[], extra?: React.ReactNode, emptyText?: string) {
    if (items.length === 0 && !extra && !emptyText) return null;
    return (
      <div className="rail-group">
        <div className="rail-group-title">
          <span>{title}</span>
          {extra}
        </div>
        {items.map((item) => (
          <RailItem key={item.id} item={item} active={activeId === item.id} onSelect={(id) => void selectConversation(id)} />
        ))}
        {items.length === 0 && emptyText ? <div className="rail-empty">{emptyText}</div> : null}
      </div>
    );
  }

  const readOnlyReason = (() => {
    if (!active || !activeIsChannel || canPostHere) return null;
    if (active.archivedAt) return { kind: "archived" as const, text: "This channel is archived. It stays readable; nobody can post." };
    if (active.kind === "announce") {
      return { kind: "announce" as const, text: "Announcements are posted by mentors and team admins. Everyone can read them." };
    }
    if (active.isMember === false) return { kind: "join" as const, text: "Join this channel to post in it." };
    return { kind: "other" as const, text: "You cannot post in this channel." };
  })();

  return (
    <main className={`chat-page messages-page v2 view-${mobileView}${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <PageHeader breadcrumbs="Team / Chat" title="Chat">
          <span className={`messages-live ${live ? "on" : "off"}`}>
            <i aria-hidden="true" />
            {live ? "Live" : "Paused"}
            {inboxUnread > 0 ? ` · ${inboxUnread} unread` : ""}
          </span>
        </PageHeader>
      ) : inboxUnread > 0 ? (
        <div className="messages-embed-status" aria-live="polite">
          <span className="messages-live on">
            {inboxUnread} unread
          </span>
        </div>
      ) : null}

      {loading ? (
        <EmptyState soft title="Loading…" aria-busy />
      ) : loadError ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: loadErrorStatus,
              message: loadError,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadError,
            },
          );
          return (
            <EmptyState
              title={copy.title}
              description={copy.description}
              badge="Setup"
              badgeTone="setup"
            >
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => void reloadMessages()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : (
        <div className="messages-layout">
          <aside className="chat-sidebar" aria-label="Channels and conversations">
            <div className="rail-head">
              <strong>Channels</strong>
              {permissions.canCreate ? (
                <button type="button" className="rail-action" style={{ width: "auto" }} onClick={openChannelDialog} disabled={sending}>
                  + New channel
                </button>
              ) : null}
            </div>

            {groups.general ? (
              <RailItem
                item={groups.general}
                active={activeId === groups.general.id}
                onSelect={(id) => void selectConversation(id)}
              />
            ) : null}

            {renderGroup("Announcements", groups.announce)}
            {renderGroup("Subteams", groups.subteam)}
            {renderGroup("Channels", groups.open)}
            {renderGroup(
              "Direct messages",
              groups.dms,
              <button type="button" onClick={() => void openMemberPicker()} disabled={sending}>
                New
              </button>,
              "Message a teammate.",
            )}
            {groups.archived.length > 0 ? (
              <div className="rail-group">
                <div className="rail-group-title">
                  <span>Archived</span>
                  <button type="button" onClick={() => setArchivedOpen((open) => !open)} aria-expanded={archivedOpen}>
                    {archivedOpen ? "Hide" : `Show ${groups.archived.length}`}
                  </button>
                </div>
                {archivedOpen
                  ? groups.archived.map((item) => (
                      <RailItem key={item.id} item={item} active={activeId === item.id} onSelect={(id) => void selectConversation(id)} />
                    ))
                  : null}
              </div>
            ) : null}

            {conversations.length === 0 ? (
              <EmptyState
                soft
                title="No conversations yet"
                description="Your team channel opens with this workspace."
              />
            ) : null}

            <div className="rail-foot">
              {/* Visible to every member, not just admins: the people the rule applies to are the
                  ones who most need to be able to read it. */}
              <button
                type="button"
                className="chat-safety-toggle"
                onClick={() => {
                  setSafetyOpen((open) => !open);
                  setMobileView("thread");
                }}
                aria-expanded={safetyOpen}
              >
                {safetyOpen ? "Hide message settings" : "Message settings"}
              </button>
            </div>
          </aside>

          <section className="chat-main">
            {safetyOpen ? (
              <>
                <header>
                  <div className="thread-head-left">
                    <button type="button" className="thread-back" aria-label="Back to channels" onClick={() => setMobileView("list")}>
                      ←
                    </button>
                    <div>
                      <span className="eyebrow">Settings</span>
                      <h1>Message settings</h1>
                    </div>
                  </div>
                </header>
                <ChatSafetyPanel orgId={orgId} />
              </>
            ) : !active ? (
              <EmptyState
                soft
                title="Team messages"
                description="Pick a channel, or start a private message."
              >
                <button type="button" className="app-button" onClick={() => void openMemberPicker()}>
                  Message a teammate
                </button>
              </EmptyState>
            ) : (
              <>
                <header>
                  <div className="thread-head-left">
                    <button type="button" className="thread-back" aria-label="Back to channels" onClick={() => setMobileView("list")}>
                      ←
                    </button>
                    <div>
                      <span className="eyebrow">{kindEyebrow(active)}</span>
                      <h1>{labelFor(active)}</h1>
                      {active.description ? <p className="thread-description">{active.description}</p> : null}
                    </div>
                  </div>
                  <div className="thread-actions">
                    {active.kind === "announce" ? (
                      <span className="channel-lock" title="Only mentors and team admins can post here">
                        🔒 {permissions.canAnnounce ? "You can post" : "Read-only"}
                      </span>
                    ) : null}
                    {activeIsChannel && active.slug === GENERAL_SLUG ? (
                      <strong className="shared-warning">Visible to all org members</strong>
                    ) : null}
                    {activeIsChannel && permissions.channelsSupported && active.slug !== GENERAL_SLUG && !active.archivedAt ? (
                      active.isMember === false ? (
                        <button type="button" className="primary" onClick={() => void channelAction("join_channel", active.id)}>
                          Join
                        </button>
                      ) : (
                        <button type="button" onClick={() => void channelAction("leave_channel", active.id)}>
                          Leave
                        </button>
                      )
                    ) : null}
                    {canManageActive && !active.archivedAt ? (
                      <button type="button" className="danger" onClick={() => void channelAction("archive_channel", active.id)}>
                        Archive
                      </button>
                    ) : null}
                  </div>
                </header>

                {active.kind === "dm" && supervisionNotice ? (
                  // No dismiss control by design: the two-adult rule is only meaningful if both
                  // people can see, at all times, who else can read what they write.
                  <div className="chat-supervision-banner" role="note" aria-live="polite">
                    <span>Second adult in this chat</span>
                    {supervisionNotice}
                    <small>
                      Required by your team&rsquo;s chat safety policy. It cannot be turned off from
                      inside this conversation.
                    </small>
                  </div>
                ) : null}

                {activeIsChannel && pinned.length > 0 ? (
                  <div className="messages-pins" aria-label="Pinned match-day notes">
                    <span className="eyebrow">Pinned notes</span>
                    {pinned.map((item) => (
                      <article key={item.id}>
                        <MessageBody body={item.body} mentions={item.mentions} members={members} />
                        <footer>
                          <small>
                            {item.authorName} · {formatTime(item.pinnedAt ?? item.createdAt)}
                          </small>
                          {pinsSupported ? (
                            <button type="button" onClick={() => void togglePin(item)}>
                              Unpin
                            </button>
                          ) : null}
                        </footer>
                      </article>
                    ))}
                  </div>
                ) : null}

                <div
                  className="messages"
                  ref={messagesRef}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
                  }}
                >
                  {hasEarlier && messages.length > 0 ? (
                    <button
                      type="button"
                      className="app-button secondary messages-load-earlier"
                      onClick={() => void loadEarlier()}
                      disabled={loadingEarlier}
                    >
                      {loadingEarlier ? "Loading earlier messages…" : "Show earlier messages"}
                    </button>
                  ) : null}
                  {messages.length === 0 ? (
                    <EmptyState
                      soft
                      title="No messages yet"
                      description={
                        active.kind === "dm"
                          ? "Private to the two of you."
                          : active.kind === "announce"
                            ? "Announcements from mentors and team admins land here."
                            : "Message the whole channel. Use @name to notify someone."
                      }
                    />
                  ) : (
                    messages.map((item) =>
                      item.deletedAt ? (
                        <article className="deleted" key={item.id}>
                          <span>deleted · {formatTime(item.createdAt)}</span>
                          <p>
                            <em>Message deleted</em>
                          </p>
                        </article>
                      ) : (
                        <article
                          className={`${item.mine ? "user" : "member"}${item.pinnedAt ? " pinned" : ""}`}
                          key={item.id}
                        >
                          <span>
                            {item.mine ? "You" : item.authorName} · {formatTime(item.createdAt)}
                            {item.pinnedAt ? " · pinned" : ""}
                            {item.editedAt ? (
                              <em className="message-edited" title={`Edited ${formatTime(item.editedAt)}`}>
                                (edited)
                              </em>
                            ) : null}
                          </span>
                          {editingId === item.id ? (
                            <form className="message-edit-form" onSubmit={saveEdit}>
                              <textarea
                                aria-label="Edit message"
                                value={editText}
                                onChange={(event) => setEditText(event.target.value)}
                                maxLength={8000}
                                autoFocus
                                onKeyDown={(event) => {
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setEditingId(null);
                                  }
                                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                    event.currentTarget.form?.requestSubmit();
                                  }
                                }}
                              />
                              <div className="row">
                                <button type="submit" disabled={savingEdit || !editText.trim()}>
                                  {savingEdit ? "Saving…" : "Save"}
                                </button>
                                <button type="button" onClick={() => setEditingId(null)} disabled={savingEdit}>
                                  Cancel
                                </button>
                                {!permissions.unlimitedEdit ? (
                                  <small className="messages-composer-hint">Students can edit for 15 minutes after sending.</small>
                                ) : null}
                              </div>
                            </form>
                          ) : (
                            <MessageBody body={item.body} mentions={item.mentions} members={members} />
                          )}
                          {item.objectLink ? (
                            <a className="message-object-link" href={item.objectLink.href ?? "#"}>
                              <span className="message-object-link-kind">
                                {objectTypeLabel(item.objectLink.objectType)}
                              </span>
                              {item.objectLink.label}
                            </a>
                          ) : null}
                          {editingId !== item.id ? (
                            <div className="message-actions">
                              {pinsSupported && activeIsChannel ? (
                                <button type="button" className="message-pin" onClick={() => void togglePin(item)}>
                                  {item.pinnedAt ? "Unpin" : "Pin note"}
                                </button>
                              ) : null}
                              {canEdit(item) && !active.archivedAt ? (
                                <button type="button" className="message-edit" onClick={() => startEdit(item)}>
                                  Edit
                                </button>
                              ) : null}
                              {item.mine ? (
                                <button
                                  type="button"
                                  className="message-delete"
                                  onClick={() => void softDelete(item.id)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      ),
                    )
                  )}
                  <div ref={bottomRef} />
                </div>

                {readOnlyReason ? (
                  <div className={`thread-notice${readOnlyReason.kind === "join" ? "" : " readonly"}`} role="note">
                    <span>{readOnlyReason.text}</span>
                    {readOnlyReason.kind === "join" ? (
                      <div className="row">
                        <button type="button" className="app-button" onClick={() => void channelAction("join_channel", active.id)}>
                          Join {labelFor(active)}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <form className="chat-composer" onSubmit={send}>
                    {activeIsChannel ? (
                      <div className="messages-composer-hint">
                        {labelFor(active)} · type @ to mention · ↑↓ Enter to pick · Esc to dismiss · link a task,
                        CAD, inventory, or event
                      </div>
                    ) : null}
                    {activeIsChannel && selectedMentions.length > 0 ? (
                      <div className="messages-mention-chips" aria-label="People mentioned in this draft">
                        {selectedMentions.map((member) => (
                          <span key={member.id} className="messages-mention-chip">
                            @{member.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {activeIsChannel && pendingObjectLink ? (
                      <div className="messages-link-chip-row">
                        <span className="messages-link-chip">
                          <span className="messages-link-chip-kind">
                            {objectTypeLabel(pendingObjectLink.objectType)}
                          </span>
                          {pendingObjectLink.label}
                          <button
                            type="button"
                            className="messages-link-chip-clear"
                            aria-label="Remove linked object"
                            onClick={() => setPendingObjectLink(null)}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    ) : null}
                    <div className="messages-composer-wrap">
                      {activeIsChannel && linkPickerOpen ? (
                        <div className="messages-link-picker" role="dialog" aria-label="Link an object">
                          <div className="messages-link-picker-head">
                            {COMPOSER_OBJECT_TYPES.map((type) => (
                              <button
                                key={type}
                                type="button"
                                className={linkPickerType === type ? "active" : undefined}
                                onClick={() => {
                                  setLinkPickerType(type);
                                  setLinkQuery("");
                                }}
                              >
                                {objectTypeLabel(type)}
                              </button>
                            ))}
                          </div>
                          <input
                            className="messages-link-picker-search"
                            value={linkQuery}
                            onChange={(event) => setLinkQuery(event.target.value)}
                            placeholder={`Search ${objectTypeLabel(linkPickerType).toLowerCase()}…`}
                            aria-label="Search link targets"
                          />
                          <ul className="messages-link-picker-list" role="listbox" aria-label="Link targets">
                            {linkTargets.length === 0 ? (
                              <li className="messages-link-picker-empty">
                                No matches in this organization yet.
                              </li>
                            ) : (
                              linkTargets.map((target) => (
                                <li key={`${target.objectType}-${target.objectId}`}>
                                  <button
                                    type="button"
                                    role="option"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      setPendingObjectLink(target);
                                      setLinkPickerOpen(false);
                                      setLinkQuery("");
                                    }}
                                  >
                                    <strong>{target.label}</strong>
                                    {target.subtitle ? <small>{target.subtitle}</small> : null}
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                          <button
                            type="button"
                            className="messages-link-picker-close"
                            onClick={() => setLinkPickerOpen(false)}
                          >
                            Close
                          </button>
                        </div>
                      ) : null}
                      {activeIsChannel && activeMention ? (
                        mentionSuggestions.length > 0 ? (
                          <ul className="messages-mention-menu" role="listbox" aria-label="Mention teammate">
                            {mentionSuggestions.map((member, index) => (
                              <li key={member.id}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={index === mentionIndex}
                                  className={index === mentionIndex ? "active" : undefined}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    selectMention(member);
                                  }}
                                >
                                  <strong>{member.name}</strong>
                                  <small>{member.email}</small>
                                </button>
                              </li>
                            ))}
                            <li className="messages-mention-hint" aria-hidden="true">
                              ↑↓ move · Enter or Tab select · Esc dismiss
                            </li>
                          </ul>
                        ) : (
                          <div className="messages-mention-empty" role="status">
                            <p>
                              {members.length === 0
                                ? "No teammates to mention yet — invite under Team admin."
                                : activeMention.query
                                  ? `No org member matches @${activeMention.query}`
                                  : "Type a name to mention a teammate in this organization."}
                            </p>
                            <small>Esc to dismiss · mentions stay inside this team</small>
                            {members.length === 0 ? (
                              <a className="app-button secondary" href={withOrgHref("/team/admin", orgId)}>
                                Team admin
                              </a>
                            ) : null}
                          </div>
                        )
                      ) : null}
                      <textarea
                        ref={composerRef}
                        aria-label="Message"
                        value={text}
                        onChange={(event) => {
                          updateComposer(
                            event.target.value,
                            event.target.selectionStart ?? event.target.value.length,
                          );
                        }}
                        onClick={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                        onKeyUp={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                        onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart ?? 0)}
                        onKeyDown={onComposerKeyDown}
                        placeholder={
                          active.kind === "dm"
                            ? "Private message…"
                            : active.kind === "announce"
                              ? "Post an announcement…"
                              : `Message ${labelFor(active)}… use @name to notify someone`
                        }
                        maxLength={8000}
                      />
                    </div>
                    {activeIsChannel ? (
                      <button
                        type="button"
                        className="messages-link-toggle"
                        onClick={() => setLinkPickerOpen((open) => !open)}
                        disabled={sending}
                      >
                        Link
                      </button>
                    ) : null}
                    <button type="submit" disabled={!text.trim() || sending}>
                      Send
                    </button>
                  </form>
                )}
                {status ? (
                  <p className="chat-status" role="status">
                    {status}
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}

      {channelDialogOpen ? (
        <div className="channel-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setChannelDialogOpen(false);
        }}>
          <form className="channel-dialog" role="dialog" aria-modal="true" aria-label="New channel" onSubmit={createChannel}>
            <h2>New channel</h2>
            <div className="kind-row" role="radiogroup" aria-label="Channel type">
              {(
                [
                  ["team", "Open", "Anyone on the team can post."],
                  ["announce", "Announcements", "Only mentors and admins post; everyone reads."],
                  ["subteam", "Subteam", "Members of one subteam."],
                ] as const
              ).map(([kind, label, hint]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={newKind === kind}
                  className={newKind === kind ? "active" : undefined}
                  title={hint}
                  onClick={() => setNewKind(kind)}
                >
                  {kind === "announce" ? "🔒 " : ""}
                  {label}
                </button>
              ))}
            </div>
            <label>
              Name
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={newKind === "announce" ? "Announcements" : newKind === "subteam" ? "Programming" : "Random"}
                maxLength={60}
                autoFocus
                required
              />
              <span className="slug-preview">#{slugifyChannelTitle(newTitle || (newKind === "announce" ? "announcements" : "channel"))}</span>
            </label>
            {newKind === "subteam" ? (
              <label>
                Subteam
                <select value={newSubteamId} onChange={(event) => setNewSubteamId(event.target.value)}>
                  <option value="">No subteam link (members join themselves)</option>
                  {subteams.map((subteam) => (
                    <option key={subteam.id} value={subteam.id}>
                      {subteam.name}
                    </option>
                  ))}
                </select>
                {subteams.length === 0 ? (
                  <span className="slug-preview">
                    No subteams yet — set them up under Team / Calendar, or create the channel without a link.
                  </span>
                ) : (
                  <span className="slug-preview">Everyone on that subteam is added automatically.</span>
                )}
              </label>
            ) : null}
            <label>
              Description (optional)
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={2}
                maxLength={280}
                placeholder="What this channel is for"
              />
            </label>
            {dialogError ? (
              <p className="dialog-error" role="alert">
                {dialogError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setChannelDialogOpen(false)} disabled={creating}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={creating || !newTitle.trim()}>
                {creating ? "Creating…" : "Create channel"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {pickerOpen ? (
        <aside className="memory-panel open messages-member-panel" aria-label="Start private message">
          <button type="button" className="memory-panel-close" onClick={() => setPickerOpen(false)}>
            Close
          </button>
          <span className="eyebrow">Team members</span>
          <p>Pick someone to message.</p>
          {/* A DM refused by the org's chat safety policy fails here, with the picker still open
              and no conversation to render into. Without this the refusal was silent. */}
          {status ? (
            <p className="chat-safety-note" role="status">
              {status}
            </p>
          ) : null}
          {members.length === 0 ? (
            <EmptyState
              soft
              title="No teammates yet"
              description="Invite people under Team admin."
            >
              <a className="app-button secondary" href={withOrgHref("/team/admin", orgId)}>
                Team admin
              </a>
            </EmptyState>
          ) : (
            members.map((member) => (
              <article key={member.id}>
                <small>{member.role}</small>
                <p>
                  {member.name}
                  <br />
                  <span className="app-muted">{member.email}</span>
                </p>
                <button type="button" onClick={() => void startDm(member.id)} disabled={sending}>
                  Message
                </button>
              </article>
            ))
          )}
        </aside>
      ) : null}
    </main>
  );
}
