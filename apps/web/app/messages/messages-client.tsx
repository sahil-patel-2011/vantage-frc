"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  applyMention,
  filterMembersForMention,
  findActiveMention,
  pruneMentionIds,
  type MentionMember,
} from "../../lib/messages/mentions";
import {
  COMPOSER_OBJECT_TYPES,
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
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
} from "../../lib/offline";
import { isArchived, type Conversation, type LinkTarget, type Member, type Message } from "./messages-model";
import { MessagesReadyView } from "./messages-ready-view";
import "./youth-protection.css";
import "./channels.css";

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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
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
    try {
      const response = await fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}`);
      const data = await response.json();
      if (!response.ok) {
        const cached = await getFeatureSnapshot<{ conversations: Conversation[] }>("chat", orgId);
        if (cached?.data) {
          applyInbox(cached.data.conversations);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoadError(null);
          setLoadErrorStatus(null);
          return cached.data.conversations;
        }
        const message = data.error || "Could not load conversations.";
        setLoadError(message);
        setLoadErrorStatus(response.status);
        setStatus(message);
        return null;
      }
      setLoadError(null);
      setLoadErrorStatus(null);
      applyInbox(data.conversations ?? []);
      setFromCache(false);
      setCachedAt(null);
      if (typeof data.pinsSupported === "boolean") setPinsSupported(data.pinsSupported);
      if (typeof data.canManageChannels === "boolean") setCanManageChannels(data.canManageChannels);
      if (typeof data.channelArchiveSupported === "boolean") {
        setChannelArchiveSupported(data.channelArchiveSupported);
      }
      await putFeatureSnapshot("chat", orgId, { conversations: data.conversations ?? [] });
      return data.conversations as Conversation[];
    } catch {
      const cached = await getFeatureSnapshot<{ conversations: Conversation[] }>("chat", orgId);
      if (cached?.data) {
        applyInbox(cached.data.conversations);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setLoadError(null);
        return cached.data.conversations;
      }
      setLoadError("Could not load conversations.");
      return null;
    }
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
    const onOnline = () => {
      void syncOutbox({ orgId }).then((result) => {
        if (result.synced > 0) void loadInbox();
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [orgId, loadInbox]);

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
    if (isBrowserOffline()) {
      await queueProductWrite({
        feature: "chat_message",
        orgId,
        payload: {
          action: "send",
          orgId,
          conversationId: activeId,
          body: text,
          mentionedUserIds: active?.kind === "team" ? mentionedUserIds : [],
          objectLink: active?.kind === "team" ? pendingObjectLink : undefined,
        },
      });
      setText("");
      setMentionedUserIds([]);
      setPendingObjectLink(null);
      setStatus(QUEUED_ON_DEVICE);
      setSending(false);
      return;
    }
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
    <MessagesReadyView
      orgId={orgId}
      embedded={embedded}
      live={live}
      inboxUnread={inboxUnread}
      fromCache={fromCache}
      cachedAt={cachedAt}
      loading={loading}
      loadError={loadError}
      loadErrorStatus={loadErrorStatus}
      reloadMessages={() => void reloadMessages()}
      sending={sending}
      openMemberPicker={() => void openMemberPicker()}
      canManageChannels={canManageChannels}
      channelDraft={channelDraft}
      setChannelDraft={setChannelDraft}
      submitChannelDraft={() => void submitChannelDraft()}
      channels={channels}
      activeId={activeId}
      selectConversation={(id) => void selectConversation(id)}
      channelArchiveSupported={channelArchiveSupported}
      showArchivedChannels={showArchivedChannels}
      setShowArchivedChannels={setShowArchivedChannels}
      loadArchivedChannels={() => void loadArchivedChannels()}
      directMessages={directMessages}
      conversations={conversations}
      safetyOpen={safetyOpen}
      setSafetyOpen={setSafetyOpen}
      active={active}
      activeChannelArchived={activeChannelArchived}
      supervisionNotice={supervisionNotice}
      pinned={pinned}
      members={members}
      pinsSupported={pinsSupported}
      togglePin={(message) => void togglePin(message)}
      messagesRef={messagesRef}
      stickToBottomRef={stickToBottomRef}
      hasEarlier={hasEarlier}
      messages={messages}
      loadEarlier={() => void loadEarlier()}
      loadingEarlier={loadingEarlier}
      bottomRef={bottomRef}
      send={(event) => void send(event)}
      selectedMentions={selectedMentions}
      pendingObjectLink={pendingObjectLink}
      setPendingObjectLink={setPendingObjectLink}
      linkPickerOpen={linkPickerOpen}
      setLinkPickerOpen={setLinkPickerOpen}
      linkPickerType={linkPickerType}
      setLinkPickerType={setLinkPickerType}
      linkQuery={linkQuery}
      setLinkQuery={setLinkQuery}
      linkTargets={linkTargets}
      activeMention={activeMention}
      mentionSuggestions={mentionSuggestions}
      mentionIndex={mentionIndex}
      selectMention={selectMention}
      composerRef={composerRef}
      text={text}
      updateComposer={updateComposer}
      setComposerCursor={setComposerCursor}
      onComposerKeyDown={onComposerKeyDown}
      status={status}
      pickerOpen={pickerOpen}
      setPickerOpen={setPickerOpen}
      startDm={(peerUserId) => void startDm(peerUserId)}
      setChannelArchived={(archived) => void setChannelArchived(archived)}
      softDelete={(messageId) => void softDelete(messageId)}
    />
  );
}
