"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { TeamOpsNav } from "../../components/team-ops-nav";
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
import {
  LONG_POLL_MAX_MS,
  mergeMessages,
  nextWatermark,
  pollBackoffMs,
  totalUnread,
} from "../../lib/messages/sync";

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
  initialConversationId = null,
  initialObjectLink = null,
}: {
  orgId: string;
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
  const [live, setLive] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const sinceRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(activeId);
  const stickToBottomRef = useRef(true);
  const membersLoadedRef = useRef(false);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const inboxUnread = totalUnread(conversations);
  const activeMention =
    active?.kind === "team" && mentionMenuOpen ? findActiveMention(text, composerCursor) : null;
  const mentionSuggestions = activeMention
    ? filterMembersForMention(members, activeMention.query)
    : [];

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
      setStatus(data.error || "Could not load conversations.");
      return null;
    }
    applyInbox(data.conversations ?? []);
    if (typeof data.pinsSupported === "boolean") setPinsSupported(data.pinsSupported);
    return data.conversations as Conversation[];
  }, [applyInbox, orgId]);

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
        sinceRef.current = nextWatermark(incoming, null);
      }
      return incoming.length > 0;
    },
    [applyInbox, orgId],
  );

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
    scrollToBottom();
  }, [messages, scrollToBottom]);

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
    setStatus("");
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
    <main className="chat-page messages-page">
      <header className="team-ops-header">
        <div>
          <span className="breadcrumbs">Team / Messages</span>
          <h1>Messages</h1>
        </div>
        <span className={`messages-live ${live ? "on" : "off"}`}>
          <i aria-hidden="true" />
          {live ? "Live" : "Paused"}
          {inboxUnread > 0 ? ` · ${inboxUnread} unread` : ""}
        </span>
      </header>
      <div style={{ padding: "0 clamp(14px,2vw,28px)" }}>
        <TeamOpsNav orgId={orgId} active="messages" />
      </div>

      <aside className="chat-sidebar">
        <span className="eyebrow">Inbox</span>
        <button type="button" className="messages-new-dm" onClick={() => void openMemberPicker()} disabled={sending}>
          + Private message
        </button>
        {conversations.map((item) => (
          <button
            key={item.id}
            type="button"
            className={activeId === item.id ? "active" : ""}
            aria-current={activeId === item.id ? "true" : undefined}
            onClick={() => void selectConversation(item.id)}
          >
            <span>
              {item.kind === "team" ? "Team" : "Private"}
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
        {!loading && conversations.length === 0 ? (
          <p className="messages-sidebar-empty">No conversations yet. Your team channel opens when you need it.</p>
        ) : null}
      </aside>

      <section className="chat-main">
        {!active ? (
          <div className="empty-chat">
            <h1>Team messages</h1>
            <p>
              Use the org team channel for shared updates, or message a teammate privately. Conversations stay
              organization-scoped.
            </p>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="eyebrow">{active.kind === "team" ? "Team channel" : "Private chat"}</span>
                <h1>{labelFor(active)}</h1>
              </div>
              {active.kind === "team" ? (
                <strong className="shared-warning">Visible to all org members</strong>
              ) : null}
            </header>

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
              onScroll={(event) => {
                const node = event.currentTarget;
                stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
              }}
            >
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <h1>No messages yet.</h1>
                  <p>
                    {active.kind === "team"
                      ? "Say something the whole team should see—pit schedule, travel notes, or a quick heads-up. Use @name to notify someone, and pin important match-day notes."
                      : "Start a private thread with this teammate. Only the two of you can read it."}
                  </p>
                </div>
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
                    <article className={`${item.mine ? "user" : "member"}${item.pinnedAt ? " pinned" : ""}`} key={item.id}>
                      <span>
                        {item.mine ? "You" : item.authorName} · {formatTime(item.createdAt)}
                        {item.pinnedAt ? " · pinned" : ""}
                      </span>
                      <MessageBody body={item.body} mentions={item.mentions} members={members} />
                      {item.objectLink ? (
                        <a className="message-object-link" href={item.objectLink.href ?? "#"}>
                          <span className="message-object-link-kind">{objectTypeLabel(item.objectLink.objectType)}</span>
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
                          <button type="button" className="message-delete" onClick={() => void softDelete(item.id)}>
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
                  Team channel · type @ to mention · link a task, CAD, inventory, or event
                </div>
              ) : null}
              {active.kind === "team" && pendingObjectLink ? (
                <div className="messages-link-chip-row">
                  <span className="messages-link-chip">
                    <span className="messages-link-chip-kind">{objectTypeLabel(pendingObjectLink.objectType)}</span>
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
                        <li className="messages-link-picker-empty">No matches yet.</li>
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
                    <button type="button" className="messages-link-picker-close" onClick={() => setLinkPickerOpen(false)}>
                      Close
                    </button>
                  </div>
                ) : null}
                {active.kind === "team" && activeMention && mentionSuggestions.length > 0 ? (
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
                  </ul>
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
                    active.kind === "team"
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
              <button type="submit" disabled={!text.trim() || sending}>
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

      {pickerOpen ? (
        <aside className="memory-panel open messages-member-panel" aria-label="Start private message">
          <button type="button" className="memory-panel-close" onClick={() => setPickerOpen(false)}>
            Close
          </button>
          <span className="eyebrow">Team members</span>
          <p>Private chats stay inside this organization. Only you and the other member can read them.</p>
          {members.length === 0 ? (
            <p className="messages-sidebar-empty">Invite teammates under Team Admin, then message them here.</p>
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
