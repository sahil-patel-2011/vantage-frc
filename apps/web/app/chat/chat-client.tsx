"use client";

import { useEffect, useState } from "react";
import { AiHubRelated } from "../../components/ai-hub-related";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { SponsoredPromoBanner } from "../../components/sponsored-promo-banner";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { ModelProvenance } from "../../components/ui";
import {
  AI_CHAT_RELATED_INCLUDE,
  AI_CHAT_SCOPE_CARDS,
  aiChatNextActions,
  aiChatRelatedLinks,
  aiChatShellCopy,
  classifyAiChatShell,
  type AiChatShellKind,
} from "../../lib/ai-chat/ai-chat-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

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

function bridgeRefs(refs: SourceRef[] | null | undefined) {
  return (refs ?? []).filter(
    (ref) =>
      ref.type === "github_file" ||
      ref.type === "vscode_selection" ||
      ref.classification === "github_file" ||
      ref.classification === "vscode_selection",
  );
}

function ChatRelatedStrip({ orgId }: { orgId: string }) {
  const links = aiChatRelatedLinks(orgId, { include: [...AI_CHAT_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related ch-related" aria-label="Related AI and competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActions({ orgId, shell }: { orgId: string; shell: AiChatShellKind }) {
  const actions = aiChatNextActions({ orgId, shell });
  if (!actions.length) return null;
  return (
    <section className="ch-next-actions app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ChatClient({
  orgId,
  initialPrompt = "",
  source = "",
  contextId = "",
}: {
  orgId: string;
  initialPrompt?: string;
  source?: string;
  contextId?: string;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memorySettings, setMemorySettings] = useState<MemorySettings | null>(null);
  const [text, setText] = useState(initialPrompt);
  const [memory, setMemory] = useState("");
  const [status, setStatus] = useState(
    source === "vscode"
      ? contextId
        ? `Opened from VS Code with editor context ${contextId.slice(0, 8)}…`
        : "Opened from VS Code"
      : "",
  );
  const [lastTools, setLastTools] = useState<ToolOutput[]>([]);
  const [privateBudget, setPrivateBudget] = useState(1200);
  const [teamBudget, setTeamBudget] = useState(1600);
  const [pendingEditorContextId, setPendingEditorContextId] = useState(contextId);
  const [promptCachingEnabled, setPromptCachingEnabled] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providerSetup, setProviderSetup] = useState<{
    message: string;
    steps: Array<{ id: string; label: string; detail: string; href: string }>;
  } | null>(null);

  async function load(threadId?: string) {
    if (!threadId) {
      setLoading(true);
      setLoadError(null);
    }
    const response = await fetch(`/api/agent?orgId=${orgId}${threadId ? `&threadId=${threadId}` : ""}`);
    const data = await response.json();
    setHttpStatus(response.status);
    if (!response.ok) {
      setLoadError(data.error ?? "Unable to load assistant channels");
      if (!threadId) setLoading(false);
      return;
    }
    setLoadError(null);
    setThreads(data.threads ?? []);
    setMemories(data.memories ?? []);
    setPromptCachingEnabled(Boolean(data.promptCachingEnabled));
    if (data.memorySettings) {
      setMemorySettings(data.memorySettings);
      setPrivateBudget(data.memorySettings.private?.tokenBudget ?? 1200);
      setTeamBudget(data.memorySettings.team?.tokenBudget ?? 1600);
    }
    if (threadId) setMessages(data.messages ?? []);
    if (!threadId) setLoading(false);
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
    if (!response.ok) {
      const cutoff = resolveCutoffErrorCode(response.status, data);
      if (cutoff) setCutoffCode(cutoff);
      if (data.code === "setup_required" || data.status === "setup_required") {
        setProviderSetup({
          message: data.message ?? data.error ?? "Configure an AI provider key before chatting.",
          steps: Array.isArray(data.steps) ? data.steps : [],
        });
      }
      setStatus(data.error ?? "Could not create channel.");
      return;
    }
    setCutoffCode(null);
    setProviderSetup(null);
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
    setCutoffCode(null);
    setProviderSetup(null);
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "message",
        orgId,
        threadId: thread.id,
        scope: thread.scope,
        message: text,
        ...(pendingEditorContextId ? { editorContextId: pendingEditorContextId } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const cutoff = resolveCutoffErrorCode(response.status, data);
      if (cutoff) setCutoffCode(cutoff);
      if (data.code === "setup_required" || data.status === "setup_required") {
        setProviderSetup({
          message: data.message ?? data.error ?? "Configure an AI provider key before chatting.",
          steps: Array.isArray(data.steps) ? data.steps : [],
        });
      }
      setStatus(data.error ?? "Agent request failed.");
      return;
    }
    const tools = (data.toolOutputs ?? []) as ToolOutput[];
    setLastTools(tools);
    const toolLabel = tools.length
      ? `${tools.length} tool${tools.length === 1 ? "" : "s"} (${tools.map((t) => t.name).join(", ")})`
      : "no tools";
    const cites = data.contextSources?.length ?? 0;
    const bridge = (data.bridgeProvenance ?? []) as Array<{ label?: string; type?: string }>;
    const bridgeLabel = bridge.length
      ? ` · ${bridge.map((b) => b.label ?? b.type).join("; ")}`
      : "";
    setStatus(`Used ${toolLabel}; ${cites} provenance source${cites === 1 ? "" : "s"}${bridgeLabel}.`);
    if (pendingEditorContextId) setPendingEditorContextId("");
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

  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const knowledgeHref = withOrgHref("/team?tab=knowledge", orgId);
  const usageHref = hubHref("/ai", "usage", orgId);
  const runsHref = withOrgHref("/team/ai-runs", orgId);
  const promptsHref = withOrgHref("/team/prompts", orgId);
  const relatedExtra = aiChatRelatedLinks(orgId, {
    include: ["usage", "scouting", "knowledge", "governance", "code"],
  });

  const shell = classifyAiChatShell({
    loading,
    status: httpStatus,
    error: loadError,
    providerSetup: Boolean(providerSetup),
    threadCount: threads.length,
    hasActiveThread: Boolean(thread),
  });
  const shellCopy = aiChatShellCopy(shell);
  /** Newest reply that actually reported a model — the thread's current endpoint. */
  const lastAssistant = [...messages]
    .reverse()
    .find((item) => item.role === "assistant" && Boolean(item.model));
  const blocked = shell === "auth_required" || shell === "error";
  const showStatusShell =
    shell === "setup" || shell === "loading" || shell === "auth_required" || shell === "error";

  return (
    <main className="module-page ch-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">AI / Assistant</span>
          <h1>FRC Assistant</h1>
          <p>
            Ask about teams, matchups, and scout evidence. Authorized tools run when you mention teams or matches.
            Empty Neon/TBA/scout results stay empty — nothing is invented.
          </p>
        </div>
        <div className="ch-header-actions">
          <span className={`app-badge ${thread?.scope === "team" ? "setup" : "good"}`}>
            {thread?.scope === "team" ? "Team shared" : thread ? "Private" : "No channel"}
          </span>
          <button
            type="button"
            className="app-button secondary ch-context-toggle"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((v) => !v)}
          >
            {contextOpen ? "Hide context" : "Context controls"}
          </button>
        </div>
      </header>

      <AiHubRelated orgId={orgId} active="chat" />
      <ChatRelatedStrip orgId={orgId} />

      <nav className="ch-gov" aria-label="AI governance">
        <span className="ch-cache">
          Prompt caching{" "}
          <strong>{promptCachingEnabled ? "On" : "Off"}</strong>
        </span>
        <a href={`${budgetsHref}#prompt-caching`}>Manage caching</a>
        <a href={budgetsHref}>Budgets</a>
        <a href={memoryHref}>Memory</a>
        {/* Saved prompts had exactly one way in — the /team/ai-hub launcher,
            which LEGACY_HUB_REDIRECTS made unreachable and which is now
            deleted. The assistant is where you reach for a saved ask, so the
            link belongs beside Memory rather than on a grid nobody could open. */}
        <a href={promptsHref}>Prompts</a>
        <a href={strategyHref}>Strategy</a>
        <a href={usageHref}>Usage</a>
        <a href={runsHref}>AI runs</a>
        <a href={knowledgeHref}>Knowledge</a>
      </nav>

      <MeteredAiCutoffBanner orgId={orgId} errorCode={cutoffCode} compact />
      <SponsoredPromoBanner orgId={orgId} />

      {showStatusShell ? (
        <section className="app-card soft-panel product-hub-setup" role="status" aria-busy={shell === "loading"}>
          {shellCopy.badge ? <span className="app-badge setup">{shellCopy.badge}</span> : null}
          <h2>{shellCopy.title}</h2>
          <p className="app-muted">
            {providerSetup?.message && shell === "setup" ? providerSetup.message : shellCopy.description}
          </p>
          {shell === "setup" && providerSetup && providerSetup.steps.length > 0 ? (
            <ol className="strategy-setup-steps">
              {providerSetup.steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <a href={withOrgHref(step.href, orgId)}>Open</a>
                </li>
              ))}
            </ol>
          ) : null}
          {shell === "error" ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
          {shell !== "loading" ? <NextActions orgId={orgId} shell={shell} /> : null}
        </section>
      ) : null}

      {shell === "empty" ? (
        <>
          <NextActions orgId={orgId} shell={shell} />
          <section className="ch-scope" aria-label="Private versus team-shared channels">
            {AI_CHAT_SCOPE_CARDS.map((card) => (
              <article key={card.id} className="ch-scope-card soft-panel">
                <h2>{card.title}</h2>
                <p>{card.body}</p>
              </article>
            ))}
          </section>
        </>
      ) : null}

      {!blocked ? (
      <div className="ch-layout">
        <aside className="ch-sidebar" id="ch-channels" aria-label="Channels">
          <div>
            <span className="eyebrow">Channels</span>
            <h2>Your threads</h2>
          </div>
          <div className="ch-thread-actions">
            <button type="button" onClick={() => void newThread("private")}>
              + Private chat
            </button>
            <button type="button" onClick={() => void newThread("team")}>
              + Team-shared chat
            </button>
          </div>
          <ul className="ch-thread-list">
            {threads.map((item) => (
              <li key={item.id}>
                <button
                  className={thread?.id === item.id ? "active" : ""}
                  type="button"
                  onClick={() => {
                    setThread(item);
                    setLastTools([]);
                    void load(item.id);
                  }}
                >
                  <span>{item.scope === "team" ? "Shared" : "Private"}</span>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="ch-main">
          {!thread ? (
            <div className="ch-empty">
              <span className="app-badge setup">{shellCopy.badge ?? "Start here"}</span>
              <h1>{shell === "empty" ? shellCopy.title : "Pick or create a channel"}</h1>
              <p>
                {shell === "empty"
                  ? shellCopy.description
                  : "Private chats stay yours. Team-shared channels are visible to members. Authorized tools never invent rows."}
              </p>
              <div className="ch-empty-actions">
                <button type="button" className="primary-action" onClick={() => void newThread("private")}>
                  New private chat
                </button>
                <a className="app-button secondary" href={budgetsHref}>
                  Budgets
                </a>
                <a className="app-button secondary" href={memoryHref}>
                  Memory
                </a>
                <a className="app-button secondary" href={strategyHref}>
                  Strategy
                </a>
                {relatedExtra
                  .filter((link) => link.id === "scouting" || link.id === "knowledge")
                  .map((link) => (
                    <a key={link.id} className="app-button secondary" href={link.href}>
                      {link.label}
                    </a>
                  ))}
              </div>
            </div>
          ) : (
            <>
              <header className="ch-thread-head">
                <div>
                  <span className="eyebrow">
                    {thread.scope === "team" ? "Team shared channel" : "Private channel"}
                  </span>
                  <h1>{thread.title}</h1>
                </div>
                {thread.scope === "team" ? (
                  <strong className="ch-shared-banner">Every message in this channel is shared</strong>
                ) : null}
              </header>

              <div className="ch-messages">
                {messages.map((item) => {
                  const tools = toolRefs(item.sourceRefs);
                  const memoriesUsed = memoryRefs(item.sourceRefs);
                  const bridgeUsed = bridgeRefs(item.sourceRefs);
                  return (
                    <article className={`ch-msg ${item.role}`} key={item.id}>
                      <span>
                        {item.role}
                        {item.explicitlyShared ? " · shared" : " · private"}
                      </span>
                      <p className="ch-msg-body">{item.content}</p>
                      {item.role === "assistant" && tools.length > 0 ? (
                        <div className="ch-tools" aria-label="Tool results">
                          {tools.map((ref) => (
                            <div
                              className={`ch-tool status-${ref.status ?? "ok"}`}
                              key={`${item.id}-${ref.id}`}
                            >
                              <strong>{ref.toolName ?? ref.id}</strong>
                              <span>{ref.classification ?? "tool"}</span>
                              <em>{ref.status === "empty" ? "empty" : ref.status ?? "ok"}</em>
                              {ref.summary ? <p>{ref.summary}</p> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {item.role === "assistant" &&
                      (tools.length > 0 || memoriesUsed.length > 0 || bridgeUsed.length > 0) ? (
                        <ul className="ch-provenance" aria-label="Provenance citations">
                          {bridgeUsed.map((ref) => (
                            <li key={`cite-bridge-${item.id}-${ref.id}`}>
                              {ref.summary ??
                                (ref.type === "github_file"
                                  ? `used GitHub path ${ref.id.replace(/^github:(?:tree:)?/, "")}`
                                  : `used VS Code selection ${ref.id.replace(/^vscode:[^:]+:/, "")}`)}
                            </li>
                          ))}
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
                      ) : null}
                      {item.model ? (
                        <>
                          {/* Per-turn label only. The quality notice is rendered once
                              below the transcript — repeating it on every message
                              would nag rather than inform. */}
                          <ModelProvenance
                            meta={{ provider: item.provider, modelId: item.model }}
                            notice={null}
                          />
                          {item.tokenCount != null ? (
                            <small>~{item.tokenCount} ctx tokens</small>
                          ) : null}
                        </>
                      ) : null}
                      {item.role === "user" && thread.scope === "private" ? (
                        <button type="button" className="ch-promote" onClick={() => void promote(item.id)}>
                          Promote to team memory
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              {/* One quality notice for the thread, driven by the newest reply. */}
              {lastAssistant ? (
                <ModelProvenance
                  meta={{ provider: lastAssistant.provider, modelId: lastAssistant.model }}
                />
              ) : null}

              {lastTools.length > 0 ? (
                <div className="ch-last-tools" aria-live="polite">
                  <span className="eyebrow">Last turn tools</span>
                  {lastTools.map((tool) => (
                    <span key={`${tool.name}-${tool.summary}`} className={`ch-tool status-${tool.status}`}>
                      <strong>{tool.name}</strong> · {tool.status}
                    </span>
                  ))}
                </div>
              ) : null}

              <form className="ch-composer" onSubmit={send}>
                {thread.scope === "team" ? (
                  <div className="ch-composer-note">Team shared · visible to members before send</div>
                ) : null}
                <textarea
                  aria-label="Message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ask about team 254 scouting, qual 42 strategy…"
                />
                <div className="ch-composer-foot">
                  <button type="submit" className="primary-action">
                    Send
                  </button>
                  {status ? (
                    <p className="ch-status" role="status">
                      {status}
                    </p>
                  ) : null}
                </div>
              </form>
            </>
          )}
        </section>

        <aside className={`ch-context${contextOpen ? " open" : ""}`} aria-label="Context controls">
          <div>
            <span className="eyebrow">Context</span>
            <h2>Injection & memory</h2>
            <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
              Private memory never enters team memory automatically. Admins set team policy under AI memory.
            </p>
          </div>

          <div className="ch-context-block">
            <div className="ch-row">
              <strong>Private injection</strong>
              <span className={`app-badge ${memorySettings?.private.enabled === false ? "setup" : "good"}`}>
                {memorySettings?.private.enabled === false ? "Off" : "On"}
              </span>
            </div>
            <div className="ch-actions">
              <button type="button" onClick={() => void setPrivateInjection(true)}>
                Enable
              </button>
              <button type="button" className="secondary" onClick={() => void setPrivateInjection(false)}>
                Disable
              </button>
            </div>
            <form className="ch-budget" onSubmit={savePrivateBudget}>
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
              <button type="submit" className="app-button secondary">
                Save budget
              </button>
            </form>
          </div>

          <div className="ch-context-block">
            <div className="ch-row">
              <strong>Team injection</strong>
              <span className={`app-badge ${memorySettings?.team?.enabled ? "good" : "setup"}`}>
                {memorySettings?.team?.enabled ? "On" : "Off"}
              </span>
            </div>
            <div className="ch-actions">
              <button type="button" onClick={() => void setTeamInjection(true)}>
                Enable team
              </button>
              <button type="button" className="secondary" onClick={() => void setTeamInjection(false)}>
                Disable team
              </button>
            </div>
            <form className="ch-budget" onSubmit={saveTeamBudget}>
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
              <button type="submit" className="app-button secondary">
                Save team budget
              </button>
            </form>
            <a href={memoryHref} style={{ fontSize: 12, fontWeight: 700, color: "var(--app-accent)" }}>
              Open AI memory governance →
            </a>
          </div>

          <div className="ch-context-block">
            <span className="eyebrow">Your private memory</span>
            <form className="ch-budget" onSubmit={saveMemory}>
              <textarea
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="Add a durable preference or fact"
                rows={3}
              />
              <button type="submit" className="app-button secondary">
                Save private memory
              </button>
            </form>
            <ul className="ch-memories">
              {memories.map((item) => (
                <li key={item.id}>
                  <article>
                    <small>{item.kind}</small>
                    <p>{item.content}</p>
                    <button type="button" className="ch-promote" onClick={() => void removeMemory(item.id)}>
                      Delete
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      ) : null}
    </main>
  );
}
