"use client";

import { useEffect, useState } from "react";
import { VantageLogo } from "../../components/brand";

type Thread = { id: string; title: string; scope: "private" | "team" };
type SourceRef = {
  type: string;
  id: string;
  classification?: string;
  toolName?: string;
  status?: string;
  summary?: string;
};
type Message = {
  id: string;
  role: string;
  content: string;
  explicitlyShared: boolean;
  provider?: string;
  model?: string;
  sourceRefs?: SourceRef[] | null;
  tokenCount?: number | null;
};
type Memory = { id: string; kind: string; content: string; disabledAt: string | null };
type MemorySettings = {
  private: { enabled: boolean; tokenBudget: number };
  team: { enabled: boolean; tokenBudget: number; retentionDays: number } | null;
};
type ToolOutput = {
  name: string;
  status: string;
  classification: string;
  summary: string;
};

function toolRefs(refs: SourceRef[] | null | undefined) {
  return (refs ?? []).filter((ref) => ref.toolName || ref.type === "module_fact");
}

function memoryRefs(refs: SourceRef[] | null | undefined) {
  return (refs ?? []).filter((ref) => ref.type === "private_memory" || ref.type === "team_memory");
}

export default function ChatClient({ orgId }: { orgId: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [text, setText] = useState("");
  const [memory, setMemory] = useState("");
  const [status, setStatus] = useState("");
  const [lastTools, setLastTools] = useState<ToolOutput[]>([]);
  const [privateBudget, setPrivateBudget] = useState(1200);
  const [teamBudget, setTeamBudget] = useState(1600);

  async function load(threadId?: string) {
    const response = await fetch(`/api/agent?orgId=${orgId}${threadId ? `&threadId=${threadId}` : ""}`);
    const data = await response.json();
    setThreads(data.threads ?? []);
    setMemories(data.memories ?? []);
    if (data.memorySettings) {
      setMemorySettings(data.memorySettings);
      setPrivateBudget(data.memorySettings.private?.tokenBudget ?? 1200);
      setTeamBudget(data.memorySettings.team?.tokenBudget ?? 1600);
    }
    if (threadId) setMessages(data.messages ?? []);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function newThread(nextScope: "private" | "team") {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "thread",
        orgId,
        scope: nextScope,
        title: nextScope === "team" ? "Team strategy channel" : "Private workspace",
      }),
    });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error);
    const value = {
      id: data.threadId,
      title: nextScope === "team" ? "Team strategy channel" : "Private workspace",
      scope: nextScope,
    };
    setThread(value);
    setMessages([]);
    setLastTools([]);
    await load();
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!thread || !text.trim()) return;
    setStatus("Looking up authorized tools…");
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "message",
        orgId,
        threadId: thread.id,
        scope: thread.scope,
        message: text,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error);
      return;
    }
    const tools = (data.toolOutputs ?? []) as ToolOutput[];
    setLastTools(tools);
    const toolLabel = tools.length
      ? `${tools.length} tool${tools.length === 1 ? "" : "s"} (${tools.map((t) => t.name).join(", ")})`
      : "no tools";
    const cites = data.contextSources?.length ?? 0;
    setStatus(`Used ${toolLabel}; ${cites} provenance source${cites === 1 ? "" : "s"}.`);
    setText("");
    await load(thread.id);
  }

  async function saveMemory(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", orgId, kind: "preference", content: memory }),
    });
    if (response.ok) {
      setMemory("");
      await load(thread?.id);
    }
  }

  async function removeMemory(id: string) {
    if (!confirm("Delete this private memory? This cannot be undone.")) return;
    await fetch(`/api/agent/memory?id=${id}`, { method: "DELETE" });
    await load(thread?.id);
  }

  async function setPrivateInjection(enabled: boolean) {
    await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "toggle-private", orgId, enabled, tokenBudget: privateBudget }),
    });
    setStatus(enabled ? "Private memory injection enabled." : "Private memory injection disabled.");
    await load(thread?.id);
  }

  async function savePrivateBudget(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "private-budget",
        orgId,
        enabled: memorySettings?.private.enabled ?? true,
        tokenBudget: privateBudget,
      }),
    });
    setStatus(`Private memory budget set to ${privateBudget} tokens.`);
    await load(thread?.id);
  }

  async function setTeamInjection(enabled: boolean) {
    await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "toggle-team",
        orgId,
        enabled,
        tokenBudget: teamBudget,
        retentionDays: memorySettings?.team?.retentionDays ?? 365,
      }),
    });
    setStatus(enabled ? "Team memory injection enabled." : "Team memory injection disabled.");
    await load(thread?.id);
  }

  async function saveTeamBudget(event: React.FormEvent) {
    event.preventDefault();
    await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "team-budget",
        orgId,
        enabled: memorySettings?.team?.enabled ?? false,
        tokenBudget: teamBudget,
        retentionDays: memorySettings?.team?.retentionDays ?? 365,
      }),
    });
    setStatus(`Team memory budget set to ${teamBudget} tokens.`);
    await load(thread?.id);
  }

  async function promote(messageId: string) {
    const response = await fetch("/api/agent/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "promote", orgId, messageId }),
    });
    const data = await response.json();
    setStatus(response.ok ? "Promoted message into team memory." : data.error);
    if (response.ok) await load(thread?.id);
  }

  return (
    <main className="chat-page">
      <header className="workspace-top">
        <VantageLogo href={`/workspace?orgId=${orgId}`} />
        <strong>FRC ASSISTANT</strong>
        <span>{thread?.scope === "team" ? "TEAM SHARED" : "PRIVATE"}</span>
      </header>
      <aside className="chat-sidebar">
        <span className="eyebrow">CHANNELS</span>
        <button type="button" onClick={() => newThread("private")}>
          + Private chat
        </button>
        <button type="button" onClick={() => newThread("team")}>
          + Team-shared chat
        </button>
        {threads.map((item) => (
          <button
            className={thread?.id === item.id ? "active" : ""}
            key={item.id}
            type="button"
            onClick={() => {
              setThread(item);
              setLastTools([]);
              void load(item.id);
            }}
          >
            <span>{item.scope === "team" ? "SHARED" : "PRIVATE"}</span>
            {item.title}
          </button>
        ))}
      </aside>
      <section className="chat-main">
        {!thread ? (
          <div className="empty-chat">
            <h1>Ask about teams, matchups, and scout evidence.</h1>
            <p>
              FRC Assistant auto-invokes authorized tools like <code>scouting.team</code> and{" "}
              <code>strategy.match</code> when you mention teams or matches. Empty Neon/TBA/scout results stay empty —
              nothing is invented.
            </p>
          </div>
        ) : (
          <>
            <header>
              <div>
                <span className="eyebrow">{thread.scope === "team" ? "TEAM SHARED CHANNEL" : "PRIVATE CHANNEL"}</span>
                <h1>{thread.title}</h1>
              </div>
              {thread.scope === "team" && <strong className="shared-warning">EVERY MESSAGE IN THIS CHANNEL IS SHARED</strong>}
            </header>
            <div className="messages">
              {messages.map((item) => {
                const tools = toolRefs(item.sourceRefs);
                const memoriesUsed = memoryRefs(item.sourceRefs);
                return (
                  <article className={item.role} key={item.id}>
                    <span>
                      {item.role}
                      {item.explicitlyShared ? " · shared" : " · private"}
                    </span>
                    <p className="chat-message-body">{item.content}</p>
                    {item.role === "assistant" && tools.length > 0 && (
                      <div className="chat-tool-results" aria-label="Tool results">
                        {tools.map((ref) => (
                          <div className={`chat-tool-chip status-${ref.status ?? "ok"}`} key={`${item.id}-${ref.id}`}>
                            <strong>{ref.toolName ?? ref.id}</strong>
                            <span>{ref.classification ?? "tool"}</span>
                            <em>{ref.status === "empty" ? "empty" : ref.status ?? "ok"}</em>
                            {ref.summary && <p>{ref.summary}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {item.role === "assistant" && (tools.length > 0 || memoriesUsed.length > 0) && (
                      <ul className="chat-provenance" aria-label="Provenance citations">
                        {tools.map((ref) => (
                          <li key={`cite-tool-${item.id}-${ref.id}`}>
                            {ref.toolName ?? ref.id}
                            {ref.classification ? ` · ${ref.classification}` : ""}
                            {ref.status === "empty" ? " · no rows" : ""}
                          </li>
                        ))}
                        {memoriesUsed.map((ref) => (
                          <li key={`cite-mem-${item.id}-${ref.id}`}>
                            {ref.type.replace("_", " ")} · {ref.id.slice(0, 8)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.model && (
                      <small>
                        {item.provider} / {item.model}
                        {item.tokenCount != null ? ` · ~${item.tokenCount} ctx tokens` : ""}
                      </small>
                    )}
                    {item.role === "user" && thread.scope === "private" && (
                      <button type="button" className="chat-promote" onClick={() => void promote(item.id)}>
                        Promote to team memory
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            {lastTools.length > 0 && (
              <div className="chat-last-tools" aria-live="polite">
                <span className="eyebrow">LAST TURN TOOLS</span>
                {lastTools.map((tool) => (
                  <span key={`${tool.name}-${tool.summary}`} className={`chat-tool-chip status-${tool.status}`}>
                    <strong>{tool.name}</strong> · {tool.status}
                  </span>
                ))}
              </div>
            )}
            <form className="chat-composer" onSubmit={send}>
              {thread.scope === "team" && <div>TEAM SHARED · visible to members before send</div>}
              <textarea
                aria-label="Message"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ask about team 254 scouting, qual 42 strategy…"
              />
              <button type="submit">Send</button>
            </form>
            {status && (
              <p className="chat-status" role="status">
                {status}
              </p>
            )}
          </>
        )}
      </section>
      <aside className="memory-panel">
        <span className="eyebrow">CONTEXT CONTROLS</span>
        <p>Inspect injection toggles and token budgets. Private memory never enters team memory automatically.</p>
        <div className="memory-controls">
          <div className="memory-control-row">
            <strong>Private injection</strong>
            <span>{memorySettings?.private.enabled === false ? "OFF" : "ON"}</span>
          </div>
          <div className="memory-control-actions">
            <button type="button" onClick={() => void setPrivateInjection(true)}>
              Enable
            </button>
            <button type="button" className="memory-toggle" onClick={() => void setPrivateInjection(false)}>
              Disable
            </button>
          </div>
          <form className="memory-budget-form" onSubmit={savePrivateBudget}>
            <label>
              Private token budget
              <input
                type="number"
                min={200}
                max={8000}
                value={privateBudget}
                onChange={(e) => setPrivateBudget(Number(e.target.value))}
              />
            </label>
            <button type="submit">Save budget</button>
          </form>
          <div className="memory-control-row">
            <strong>Team injection</strong>
            <span>{memorySettings?.team?.enabled ? "ON" : "OFF"}</span>
          </div>
          <div className="memory-control-actions">
            <button type="button" onClick={() => void setTeamInjection(true)}>
              Enable team
            </button>
            <button type="button" className="memory-toggle" onClick={() => void setTeamInjection(false)}>
              Disable team
            </button>
          </div>
          <form className="memory-budget-form" onSubmit={saveTeamBudget}>
            <label>
              Team token budget
              <input
                type="number"
                min={200}
                max={8000}
                value={teamBudget}
                onChange={(e) => setTeamBudget(Number(e.target.value))}
              />
            </label>
            <button type="submit">Save team budget</button>
          </form>
        </div>
        <span className="eyebrow">YOUR PRIVATE MEMORY</span>
        <form onSubmit={saveMemory}>
          <textarea value={memory} onChange={(e) => setMemory(e.target.value)} placeholder="Add a durable preference or fact" />
          <button type="submit">Save private memory</button>
        </form>
        {memories.map((item) => (
          <article key={item.id}>
            <small>{item.kind}</small>
            <p>{item.content}</p>
            <button type="button" onClick={() => void removeMemory(item.id)}>
              Delete
            </button>
          </article>
        ))}
      </aside>
    </main>
  );
}
