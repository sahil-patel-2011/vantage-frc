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
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import ChatSafetyPanel from "./chat-safety-panel";
import "./youth-protection.css";
import "./channels.css";

type Conversation = {
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

type Message = {
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

function labelFor(conversation: Conversation) {
  if (conversation.kind === "team") return conversation.title ?? "Team";
  return conversation.peerName ?? "Private chat";
}

function isArchived(conversation: Conversation) {
  return Boolean(conversation.archivedAt);
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
  const [canManageChannels, setCanManageChannels] = useState(false);
  const [channelArchiveSupported, setChannelArchiveSupported] = useState(false);
  const [showArchivedChannels, setShowArchivedChannels] = useState(false);
  const [channelDraft, setChannelDraft] = useState<{ mode: "create" | "rename"; value: string } | null>(null);
  const [live, setLive] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // Set just before an older page is prepended so the scroll position can be
  // restored relative to the previously-visible messages.
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sinceRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const stickToBottomRef = useRef(true);
  const membersLoadedRef = useRef(false);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const inboxUnread = totalUnread(conversations);
  const channels = conversations.filter((item) => item.kind === "team");
  const directMessages = conversations.filter((item) => item.kind === "dm");
  const activeChannelArchived = active?.kind === "team" && isArchived(active);
  const activeMention =
    active?.kind === "team" && mentionMenuOpen ? findActiveMention(text, composerCursor) : null;
  const mentionSuggestions = activeMention
    ? filterMembersForMention(members, activeMention.query)
    : [];
  const selectedMentions = mentionedUserIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member));

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
    if (!linkPickerOpen || active?.kind !== "team") return;
    const timer = window.setTimeout(() => {
      void loadLinkTargets(linkPickerType, linkQuery);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [active?.kind, linkPickerOpen, linkPickerType, linkQuery, loadLinkTargets]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const scrollToBottom = useCallback(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const applyInbox = useCallback((list: Conversation[]) => {
    setConversations(list);
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
    applyInbox(data.conversations ?? []);
    if (typeof data.pinsSupported === "boolean") setPinsSupported(data.pinsSupported);
    if (typeof data.canManageChannels === "boolean") setCanManageChannels(data.canManageChannels);
    if (typeof data.channelArchiveSupported === "boolean") {
      setChannelArchiveSupported(data.channelArchiveSupported);
    }
    return data.conversations as Conversation[];
  }, [applyInbox, orgId]);

  /** Archived channels are fetched on demand so the default sidebar stays the working list. */
  const loadArchivedChannels = useCallback(async () => {
    const params = new URLSearchParams({ orgId, mode: "channels", includeArchived: "1" });
    const response = await fetch(`/api/messages?${params}`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not load archived channels.");
      return;
    }
    const archived = ((data.channels ?? []) as Array<{ id: string; title: string; archivedAt: string | null }>)
      .filter((channel) => channel.archivedAt);
    setConversations((prev) => {
      const known = new Set(prev.map((item) => item.id));
      const extras: Conversation[] = archived
        .filter((channel) => !known.has(channel.id))
        .map((channel) => ({
          id: channel.id,
          kind: "team",
          title: channel.title,
          updatedAt: channel.archivedAt ?? "",
          lastMessageAt: null,
          lastBody: null,
          peerUserId: null,
          peerName: null,
          unreadCount: 0,
          archivedAt: channel.archivedAt,
          isDefaultChannel: false,
        }));
      return extras.length ? [...prev, ...extras] : prev;
    });
  }, [orgId]);

  const loadThread = useCallback(
    async (
      conversationId: string,
      opts?: { quiet?: boolean; since?: string | null; wait?: number },
    ) => {
      const params = new URLSearchParams({ orgId, conversationId });
      if (opts?.since) params.set("since", opts.since);
      if (opts?.wait && opts.wait > 0) params.set("wait", String(opts.wait));
      const response = await fetch(`/api/messages?${params}`, {
        signal: AbortSignal.timeout((opts?.wait ?? 0) + 12000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (!opts?.quiet) setStatus(data.error || "Could not load messages.");
        throw new Error(data.error || "Could not load messages.");
      }
      applyInbox(data.conversations ?? []);
      if (typeof data.pinsSupported === "boolean") setPinsSupported(data.pinsSupported);
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
    [applyInbox, orgId],
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
    if (active?.kind === "team") {
      void ensureMembers();
    }
  }, [active?.kind, ensureMembers]);

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
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open_dm", orgId, peerUserId }),
      });
      const data = await response.json();
      if (!response.ok) {
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
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send",
          orgId,
          conversationId: activeId,
          body: text,
          mentionedUserIds: active?.kind === "team" ? mentionedUserIds : [],
          objectLink: active?.kind === "team" ? pendingObjectLink : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
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
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "soft_delete", orgId, messageId }),
    });
    const data = await response.json();
    if (!response.ok) {
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

  async function submitChannelDraft() {
    if (!channelDraft) return;
    const title = channelDraft.value.trim();
    if (!title) {
      setChannelDraft(null);
      return;
    }
    setSending(true);
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        channelDraft.mode === "create"
          ? { action: "create_channel", orgId, title }
          : { action: "rename_channel", orgId, conversationId: activeId, title },
      ),
    });
    const data = await response.json();
    setSending(false);
    if (!response.ok) {
      setStatus(data.error || "Could not save the channel.");
      return;
    }
    setChannelDraft(null);
    setStatus("");
    await loadInbox();
    if (channelDraft.mode === "create" && data.conversationId) {
      await selectConversation(data.conversationId);
    }
  }

  async function setChannelArchived(archived: boolean) {
    if (!active || active.kind !== "team") return;
    setSending(true);
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: archived ? "archive_channel" : "unarchive_channel",
        orgId,
        conversationId: active.id,
      }),
    });
    const data = await response.json();
    setSending(false);
    if (!response.ok) {
      setStatus(data.error || "Could not update the channel.");
      return;
    }
    setStatus(archived ? "Channel archived. Its history is still readable." : "Channel reopened.");
    const list = await loadInbox();
    if (archived) {
      const fallback = list?.find((item) => item.isDefaultChannel) ?? list?.[0] ?? null;
      if (fallback) await selectConversation(fallback.id);
    }
  }

  async function togglePin(message: Message) {
    if (!pinsSupported || !active || active.kind !== "team") return;
    const action = message.pinnedAt ? "unpin" : "pin";
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, orgId, messageId: message.id }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || `Could not ${action} message.`);
      return;
    }
    if (activeId) {
      sinceRef.current = null;
      await loadThread(activeId);
    }
  }

  return (
    <main className={`chat-page messages-page${embedded ? " is-embedded" : ""}`}>
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
          <aside className="chat-sidebar">
            <button
              type="button"
              className="messages-new-dm"
              onClick={() => void openMemberPicker()}
              disabled={sending}
            >
              New Message
            </button>
            <div className="messages-group-heading">
              <span className="eyebrow">Channels</span>
              {canManageChannels ? (
                <button
                  type="button"
                  className="messages-channel-add"
                  onClick={() => setChannelDraft({ mode: "create", value: "" })}
                  disabled={sending}
                >
                  New channel
                </button>
              ) : null}
            </div>

            {channelDraft?.mode === "create" ? (
              <form
                className="messages-channel-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitChannelDraft();
                }}
              >
                <input
                  autoFocus
                  value={channelDraft.value}
                  maxLength={60}
                  placeholder="Channel name"
                  aria-label="New channel name"
                  onChange={(event) => setChannelDraft({ mode: "create", value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setChannelDraft(null);
                  }}
                />
                <button type="submit" disabled={sending}>
                  Create
                </button>
                <button type="button" onClick={() => setChannelDraft(null)}>
                  Cancel
                </button>
              </form>
            ) : null}

            {channels.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`${activeId === item.id ? "active" : ""}${isArchived(item) ? " is-archived" : ""}`}
                aria-current={activeId === item.id ? "true" : undefined}
                onClick={() => void selectConversation(item.id)}
              >
                <span>
                  {isArchived(item) ? "Archived" : "Channel"}
                  {item.unreadCount > 0 ? (
                    <b className="messages-unread" aria-label={`${item.unreadCount} unread`}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </b>
                  ) : null}
                </span>
                {labelFor(item)}
                {item.lastBody ? <small className="messages-preview">{item.lastBody}</small> : null}
              </button>
            ))}

            {channelArchiveSupported && !showArchivedChannels ? (
              <button
                type="button"
                className="messages-channel-archive-toggle"
                onClick={() => {
                  setShowArchivedChannels(true);
                  void loadArchivedChannels();
                }}
              >
                Show archived channels
              </button>
            ) : null}

            <div className="messages-group-heading">
              <span className="eyebrow">Direct messages</span>
            </div>

            {directMessages.map((item) => (
              <button
                key={item.id}
                type="button"
                className={activeId === item.id ? "active" : ""}
                aria-current={activeId === item.id ? "true" : undefined}
                onClick={() => void selectConversation(item.id)}
              >
                <span>
                  Private
                  {item.unreadCount > 0 ? (
                    <b className="messages-unread" aria-label={`${item.unreadCount} unread`}>
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </b>
                  ) : null}
                </span>
                {labelFor(item)}
                {item.lastBody ? <small className="messages-preview">{item.lastBody}</small> : null}
              </button>
            ))}

            {directMessages.length === 0 ? (
              <p className="messages-group-empty">No private conversations yet.</p>
            ) : null}

            {conversations.length === 0 ? (
              <EmptyState
                soft
                title="No conversations yet"
                description="Your team channel opens with this workspace."
              />
            ) : null}
            {/* Visible to every member, not just admins: the people the rule applies to are the
                ones who most need to be able to read it. */}
            <button
              type="button"
              className="chat-safety-toggle"
              onClick={() => setSafetyOpen((open) => !open)}
              aria-expanded={safetyOpen}
            >
              {safetyOpen ? "Hide message settings" : "Message settings"}
            </button>
          </aside>

          <section className="chat-main">
            {safetyOpen ? (
              <ChatSafetyPanel orgId={orgId} />
            ) : !active ? (
              <EmptyState
                soft
                title="Team messages"
                description="The team channel, or a private message."
              >
                <button type="button" className="app-button" onClick={() => void openMemberPicker()}>
                  Message a teammate
                </button>
              </EmptyState>
            ) : (
              <>
                <header>
                  <div>
                    <span className="eyebrow">
                      {active.kind !== "team"
                        ? "Private chat"
                        : activeChannelArchived
                          ? "Archived channel"
                          : "Team channel"}
                    </span>
                    {channelDraft?.mode === "rename" ? (
                      <form
                        className="messages-channel-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitChannelDraft();
                        }}
                      >
                        <input
                          autoFocus
                          value={channelDraft.value}
                          maxLength={60}
                          aria-label="Channel name"
                          onChange={(event) => setChannelDraft({ mode: "rename", value: event.target.value })}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setChannelDraft(null);
                          }}
                        />
                        <button type="submit" disabled={sending}>
                          Save
                        </button>
                        <button type="button" onClick={() => setChannelDraft(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <h1>{labelFor(active)}</h1>
                    )}
                  </div>
                  {active.kind === "team" ? (
                    <div className="messages-channel-actions">
                      <strong className="shared-warning">Visible to all org members</strong>
                      {canManageChannels && !active.isDefaultChannel && !channelDraft ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setChannelDraft({ mode: "rename", value: labelFor(active) })}
                            disabled={sending}
                          >
                            Rename
                          </button>
                          {channelArchiveSupported ? (
                            <button
                              type="button"
                              onClick={() => void setChannelArchived(!activeChannelArchived)}
                              disabled={sending}
                            >
                              {activeChannelArchived ? "Reopen" : "Archive"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </header>

                {activeChannelArchived ? (
                  <div className="chat-supervision-banner" role="note">
                    <span>Archived channel</span>
                    History stays readable and exportable. Reopen the channel to post again.
                  </div>
                ) : null}

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

                {active.kind === "team" && pinned.length > 0 ? (
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
                        active.kind === "team"
                          ? "Message the whole team. Use @name to notify someone."
                          : "Private to the two of you."
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
                          </span>
                          <MessageBody body={item.body} mentions={item.mentions} members={members} />
                          {item.objectLink ? (
                            <a className="message-object-link" href={item.objectLink.href ?? "#"}>
                              <span className="message-object-link-kind">
                                {objectTypeLabel(item.objectLink.objectType)}
                              </span>
                              {item.objectLink.label}
                            </a>
                          ) : null}
                          <div className="message-actions">
                            {pinsSupported && active.kind === "team" ? (
                              <button type="button" className="message-pin" onClick={() => void togglePin(item)}>
                                {item.pinnedAt ? "Unpin" : "Pin note"}
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
                        </article>
                      ),
                    )
                  )}
                  <div ref={bottomRef} />
                </div>

                <form className="chat-composer" onSubmit={send}>
                  {active.kind === "team" ? (
                    <div className="messages-composer-hint">
                      Team channel · type @ to mention · ↑↓ Enter to pick · Esc to dismiss · link a task,
                      CAD, inventory, or event
                    </div>
                  ) : null}
                  {active.kind === "team" && selectedMentions.length > 0 ? (
                    <div className="messages-mention-chips" aria-label="People mentioned in this draft">
                      {selectedMentions.map((member) => (
                        <span key={member.id} className="messages-mention-chip">
                          @{member.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {active.kind === "team" && pendingObjectLink ? (
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
                    {active.kind === "team" && linkPickerOpen ? (
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
                    {active.kind === "team" && activeMention ? (
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
                      disabled={activeChannelArchived}
                      placeholder={
                        activeChannelArchived
                          ? "This channel is archived. Reopen it to post."
                          : active.kind === "team"
                            ? "Message the team… use @name to notify someone"
                            : "Private message…"
                      }
                      maxLength={8000}
                    />
                  </div>
                  {active.kind === "team" ? (
                    <button
                      type="button"
                      className="messages-link-toggle"
                      onClick={() => setLinkPickerOpen((open) => !open)}
                      disabled={sending}
                    >
                      Link
                    </button>
                  ) : null}
                  <button type="submit" disabled={!text.trim() || sending || activeChannelArchived}>
                    Send
                  </button>
                </form>
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
