"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { VantageLogo } from "../../components/brand";

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
  authorUserId: string;
  authorName: string;
  deletedAt: string | null;
  mine: boolean;
};

type Member = { id: string; name: string; email: string; role: string };

function labelFor(conversation: Conversation) {
  if (conversation.kind === "team") return conversation.title ?? "Team";
  return conversation.peerName ?? "Private chat";
}

function formatTime(value: string | null) {
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

export default function MessagesClient({ orgId }: { orgId: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sinceRef = useRef<string | null>(null);

  const active = conversations.find((item) => item.id === activeId) ?? null;

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const loadInbox = useCallback(async () => {
    const response = await fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not load conversations.");
      return null;
    }
    setConversations(data.conversations ?? []);
    return data.conversations as Conversation[];
  }, [orgId]);

  const loadThread = useCallback(
    async (conversationId: string, opts?: { quiet?: boolean; since?: string | null }) => {
      const params = new URLSearchParams({ orgId, conversationId });
      if (opts?.since) params.set("since", opts.since);
      const response = await fetch(`/api/messages?${params}`);
      const data = await response.json();
      if (!response.ok) {
        if (!opts?.quiet) setStatus(data.error || "Could not load messages.");
        return;
      }
      setConversations(data.conversations ?? []);
      if (opts?.since) {
        const incoming = (data.messages ?? []) as Message[];
        if (incoming.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            return [...prev, ...incoming.filter((m) => !seen.has(m.id))];
          });
        }
      } else {
        setMessages(data.messages ?? []);
      }
      const last = ((data.messages ?? []) as Message[]).at(-1);
      if (last) sinceRef.current = last.createdAt;
      else if (!opts?.since) sinceRef.current = null;
    },
    [orgId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await loadInbox();
      if (cancelled) return;
      const team = list?.find((item) => item.kind === "team");
      const first = team ?? list?.[0] ?? null;
      if (first) {
        setActiveId(first.id);
        await loadThread(first.id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadInbox, loadThread]);

  useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(() => {
      void loadThread(activeId, { quiet: true, since: sinceRef.current });
      void loadInbox();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeId, loadInbox, loadThread]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function selectConversation(id: string) {
    setActiveId(id);
    setPickerOpen(false);
    setStatus("");
    sinceRef.current = null;
    await loadThread(id);
  }

  async function openMemberPicker() {
    setPickerOpen(true);
    const response = await fetch(`/api/messages?orgId=${encodeURIComponent(orgId)}&mode=members`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not load members.");
      return;
    }
    setMembers(data.members ?? []);
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
    setSending(true);
    setStatus("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", orgId, conversationId: activeId, body: text }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not send message.");
        return;
      }
      setText("");
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
    if (activeId) await loadThread(activeId);
  }

  return (
    <main className="chat-page messages-page">
      <header className="workspace-top">
        <VantageLogo href={`/workspace?orgId=${orgId}`} />
        <strong>TEAM MESSAGES</strong>
        <span>{active?.kind === "dm" ? "PRIVATE" : "ORG CHANNEL"}</span>
      </header>

      <aside className="chat-sidebar">
        <span className="eyebrow">INBOX</span>
        <button type="button" onClick={() => void openMemberPicker()} disabled={sending}>
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
              {item.kind === "team" ? "TEAM" : "PRIVATE"}
              {item.unreadCount > 0 ? ` · ${item.unreadCount}` : ""}
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
            <h1>Keep ops inside Vantage.</h1>
            <p>
              Use the org team channel for shared updates, or message a teammate privately. Conversations stay
              organization-scoped—no Discord or Slack silo required.
            </p>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="eyebrow">{active.kind === "team" ? "TEAM CHANNEL" : "PRIVATE CHAT"}</span>
                <h1>{labelFor(active)}</h1>
              </div>
              {active.kind === "team" ? (
                <strong className="shared-warning">VISIBLE TO ALL ORG MEMBERS</strong>
              ) : null}
            </header>

            <div className="messages">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <h1>No messages yet.</h1>
                  <p>
                    {active.kind === "team"
                      ? "Say something the whole team should see—pit schedule, travel notes, or a quick heads-up."
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
                    <article className={item.mine ? "user" : "member"} key={item.id}>
                      <span>
                        {item.mine ? "You" : item.authorName} · {formatTime(item.createdAt)}
                      </span>
                      <p>{item.body}</p>
                      {item.mine ? (
                        <button type="button" className="message-delete" onClick={() => void softDelete(item.id)}>
                          Delete
                        </button>
                      ) : null}
                    </article>
                  ),
                )
              )}
              <div ref={bottomRef} />
            </div>

            <form className="chat-composer" onSubmit={send}>
              {active.kind === "team" ? <div>TEAM CHANNEL · all org members can read this</div> : null}
              <textarea
                aria-label="Message"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={active.kind === "team" ? "Message the team…" : "Private message…"}
                maxLength={8000}
              />
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
          <span className="eyebrow">TEAM MEMBERS</span>
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
