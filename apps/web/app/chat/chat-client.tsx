"use client";

import { aiConnectionHref } from "../../lib/ai/connection";

import { useEffect, useMemo, useRef, useState } from "react";
import { AiActionProposals } from "../../components/ai-action-proposals";
import { AiSponsorBranding } from "../../components/ai-sponsor-branding";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { SponsoredPromoBanner } from "../../components/sponsored-promo-banner";
import { resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { ModelProvenance, Button, EmptyState, PageMain, askConfirm } from "../../components/ui";
import {
  AI_CHAT_SCOPE_CARDS,
  aiChatShellCopy,
  classifyAiChatShell,
  type AiChatShellKind,
} from "../../lib/ai-chat/ai-chat-related";
import {
  aiSkillById,
  canSaveSkillDraft,
  pageLabelFor,
  type AiSkillDraftKind,
} from "../../lib/ai-skills/catalog";
import { sponsorDraftKind } from "../../lib/ai-skills/sponsorships";
import { hubHref } from "../../lib/nav/hubs";
import { fetchProductSession } from "../../lib/nav/product-session";
import { withOrgHref } from "../../lib/nav/product-nav";
import { strategyCanSync } from "../../lib/strategy/strategy-related";
import {
  SkillChip,
  SkillPreviewCard,
  SkillStarters,
  StarterGroups,
  type SkillAvailabilityRow,
  type SkillPreview,
} from "./ask-ai-skills";
import { BackgroundRunCard, backgroundRunLabel, useBackgroundWork } from "./background-work";

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
type TurnSkill = { id: string; name: string; source: "pinned" | "keyword" | "model" };

/** The page Ask AI was opened from: shown on the chip, sent to the skill as data. */
export type AskAiPageContext = {
  from?: string | null;
  about?: string | null;
  sponsorId?: string | null;
  teamKey?: string | null;
  matchKey?: string | null;
};

/** Tool references other than skills (skills get their own line). */
function toolRefs(refs: SourceRef[] | null | undefined) {
  return (refs ?? []).filter((ref) => (ref.toolName || ref.type === "module_fact") && !ref.toolName?.startsWith("skill."));
}

function skillRefs(refs: SourceRef[] | null | undefined) {
  return (refs ?? []).filter((ref) => ref.toolName?.startsWith("skill."));
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

const DRAFT_KIND_LABEL: Record<AiSkillDraftKind, string> = {
  cold_intro: "Intro email",
  sponsorship_ask: "Sponsorship ask",
  renewal: "Renewal email",
  thank_you: "Thank-you",
  grant_followup: "Grant follow-up",
  grant: "Grant answer",
};

function ChatStatusPrimary({
  shell,
  onRetry,
  connectionHref,
}: {
  shell: AiChatShellKind;
  onRetry: () => void;
  connectionHref: string;
}) {
  switch (shell) {
    case "error":
      return (
        <Button variant="primary" type="button" onClick={onRetry}>
          Retry
        </Button>
      );
    case "auth_required":
      return (
        <Button as="a" variant="primary" href="/signin">
          Sign in
        </Button>
      );
    case "setup":
      return (
        <Button as="a" variant="primary" href={connectionHref}>
          Connect AI
        </Button>
      );
    case "loading":
    case "empty":
    case "ready":
      return null;
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

/**
 * Ask AI — the one assistant. It picks a skill for each question (or keeps the one the person or
 * the page chose), and every page opens it the same way. Writer drafting and the former Agent
 * tab live here too: the Writing skill, and "Work on this in the background".
 */
export default function ChatClient({
  orgId,
  initialPrompt = "",
  source = "",
  contextId = "",
  initialSkill = null,
  page = {},
  initialMode = null,
}: {
  orgId: string;
  initialPrompt?: string;
  source?: string;
  contextId?: string;
  /** Skill to open on (the page's skill, or ?skill=). */
  initialSkill?: string | null;
  page?: AskAiPageContext;
  /** "background": open with "Work on this in the background" on (the former Agent tab). */
  initialMode?: "background" | null;
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
      : source === "kickoff"
        ? "Opened from Kickoff with this year's game brief. Send when you are ready."
        : "",
  );
  const [privateBudget, setPrivateBudget] = useState(1200);
  const [teamBudget, setTeamBudget] = useState(1600);
  const [pendingEditorContextId, setPendingEditorContextId] = useState(contextId);
  const [promptCachingEnabled, setPromptCachingEnabled] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A send that fails because AI is off keeps the thread and the typed question on screen with a
  // "Not sent" note; it used to swap the whole thread for a setup card and the question was gone.
  const [notSent, setNotSent] = useState<string | null>(null);
  const [providerSetup, setProviderSetup] = useState<{
    message: string;
    steps: Array<{ id: string; label: string; detail: string; href: string }>;
  } | null>(null);
  const [sending, setSending] = useState(false);

  // Skills: which ones this member may use, the one pinned (chip / page), the one the last
  // question used, and what it found when AI couldn't answer.
  const [availability, setAvailability] = useState<SkillAvailabilityRow[] | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(aiSkillById(initialSkill)?.id ?? null);
  const [lastSkill, setLastSkill] = useState<TurnSkill | null>(null);
  const [skillNotice, setSkillNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillPreview | null>(null);
  const [answerPreviews, setAnswerPreviews] = useState<SkillPreview[]>([]);
  const [newScope, setNewScope] = useState<"private" | "team">("private");
  const [background, setBackground] = useState(initialMode === "background");
  const bg = useBackgroundWork(orgId);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const fromLabel = pageLabelFor(page.from ?? null);
  const shownSkillId = pinned ?? lastSkill?.id ?? null;
  const viewOnly = role === "viewer";

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
    if (Array.isArray(data.skills)) setAvailability(data.skills);
    if (typeof data.role === "string") setRole(data.role);
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

  useEffect(() => {
    let cancelled = false;
    void fetchProductSession(orgId).then((session) => {
      if (cancelled) return;
      const membership = session?.memberships?.find((entry) => entry.orgId === orgId);
      setCanManageTeam(strategyCanSync(membership?.role ?? session?.role));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // A pinned skill the member can't use falls back to choosing (and says so once).
  useEffect(() => {
    if (!pinned || !availability?.length) return;
    const row = availability.find((entry) => entry.id === pinned);
    if (row && !row.available) {
      setSkillNotice(row.reason);
      setPinned(null);
    }
  }, [availability, pinned]);

  async function newThread(nextScope: "private" | "team", title?: string): Promise<Thread | null> {
    const label = title?.trim() ? title.trim().slice(0, 60) : nextScope === "team" ? "Team strategy channel" : "Private chat";
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "thread", orgId, scope: nextScope, title: label }),
    });
    const data = await response.json();
    if (!response.ok) {
      const cutoff = resolveCutoffErrorCode(response.status, data);
      if (cutoff) setCutoffCode(cutoff);
      if (data.code === "setup_required" || data.status === "setup_required") {
        setProviderSetup({
          message: data.message ?? data.error ?? "Ask a mentor to add a key before chatting.",
          steps: Array.isArray(data.steps) ? data.steps : [],
        });
      }
      setStatus(data.error ?? "Could not start a chat.");
      return null;
    }
    setCutoffCode(null);
    setProviderSetup(null);
    const value: Thread = { id: data.threadId, title: label, scope: nextScope };
    setThread(value);
    setMessages([]);
    await load();
    return value;
  }

  function startOver() {
    setThread(null);
    setMessages([]);
    setPreview(null);
    setAnswerPreviews([]);
    setNotSent(null);
    setStatus("");
    bg.close();
    composerRef.current?.focus();
  }

  async function sendBackground(goal: string) {
    setStatus("Working on it in the background — you can keep reading.");
    const failure = await bg.start(goal);
    if (failure) {
      if (failure.cutoff) setCutoffCode(failure.cutoff);
      setNotSent(failure.message);
      setStatus("");
      return;
    }
    setText("");
    setStatus("Background work finished.");
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = text.trim();
    if (!question || sending) return;
    setCutoffCode(null);
    setProviderSetup(null);
    setNotSent(null);
    setPreview(null);
    setSkillNotice(null);
    if (background) {
      await sendBackground(question);
      return;
    }
    setSending(true);
    try {
      const active = thread ?? (await newThread(viewOnly ? "private" : newScope, question));
      if (!active) return;
      setStatus("Looking at your team's records…");
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "message",
          orgId,
          threadId: active.id,
          scope: active.scope,
          message: text,
          skill: pinned,
          page,
          ...(pendingEditorContextId ? { editorContextId: pendingEditorContextId } : {}),
        }),
      });
      const data = await response.json();
      if (data.skill?.id) {
        setLastSkill({ id: data.skill.id, name: data.skill.name, source: data.skill.source });
      }
      if (data.skillNotice) setSkillNotice(data.skillNotice);
      if (!response.ok) {
        const cutoff = resolveCutoffErrorCode(response.status, data);
        if (cutoff) setCutoffCode(cutoff);
        if (data.skillPreview) setPreview(data.skillPreview as SkillPreview);
        if (data.code === "setup_required" || data.status === "setup_required") {
          setNotSent(data.message ?? data.error ?? "AI isn't on for your team yet.");
          setStatus("");
          return;
        }
        setStatus(data.error ?? "Ask AI couldn't answer that just now.");
        return;
      }
      setAnswerPreviews(Array.isArray(data.skillOutputs) ? (data.skillOutputs as SkillPreview[]) : []);
      setStatus("");
      if (pendingEditorContextId) setPendingEditorContextId("");
      setText("");
      await load(active.id);
    } finally {
      setSending(false);
    }
  }

  async function saveDraft(message: Message, previousQuestion: string) {
    const skillId = skillRefs(message.sourceRefs)[0]?.toolName?.slice("skill.".length) ?? shownSkillId;
    const skill = aiSkillById(skillId);
    if (!skill?.saveDraft) return;
    const kind: AiSkillDraftKind = skill.id === "sponsorships" ? sponsorDraftKind(previousQuestion) : skill.saveDraft;
    const target = page.about?.trim() || null;
    const response = await fetch("/api/writer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save-draft",
        orgId,
        kind,
        title: `${DRAFT_KIND_LABEL[kind]}${target ? ` — ${target}` : ""}`,
        targetName: target ?? undefined,
        body: message.content,
        source: "ai",
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setStatus(response.ok ? "Saved to your drafts. Open Writer to edit or send it." : (data.error ?? "That draft couldn't be saved."));
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
    if (!(await askConfirm({ title: "Delete this private memory?", body: "This cannot be undone.", confirmLabel: "Delete private memory", tone: "destructive" }))) return;
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
    const response = await fetch("/api/agent/memory", {
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
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus(data?.error ?? "Team memory could not be changed.");
      return;
    }
    setStatus(enabled ? "Team memory injection enabled." : "Team memory injection disabled.");
    await load(thread?.id);
  }

  async function saveTeamBudget(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/agent/memory", {
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
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatus(data?.error ?? "Team memory budget could not be saved.");
      return;
    }
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

  function pickStarter(skillId: string | null, starter: string) {
    if (skillId) setPinned(skillId);
    setText(starter);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const knowledgeHref = withOrgHref("/team?tab=knowledge", orgId);
  const usageHref = hubHref("/ai", "usage", orgId);
  const runsHref = withOrgHref("/team/ai-runs", orgId);
  const promptsHref = withOrgHref("/team/prompts", orgId);
  const draftsHref = hubHref("/ai", "writer", orgId);
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
  const blocked = shell === "auth_required" || shell === "error" || shell === "setup" || shell === "loading";
  const showStatusShell =
    shell === "setup" || shell === "loading" || shell === "auth_required" || shell === "error";
  const connectionHref = aiConnectionHref(orgId);
  const hasSide = threads.length > 0 || bg.runs.length > 0;
  const conversationEmpty = !thread && !bg.selected;
  const lastUserQuestion = useMemo(
    () => [...messages].reverse().find((item) => item.role === "user")?.content ?? "",
    [messages],
  );

  return (
    <PageMain className="module-page ch-page ask-page">
      <header className="app-page-header ask-head">
        <div>
          <h1>Ask AI</h1>
          <p>One assistant for your team. It picks the right skill for each question and answers from your team&apos;s own records.</p>
        </div>
        <div className="ch-header-actions">
          <AiSponsorBranding />
          {thread || bg.selected ? (
            <Button variant="ghost" type="button" onClick={startOver}>
              New chat
            </Button>
          ) : null}
          {!blocked ? (
            <Button variant="ghost" type="button" className="ch-context-toggle" aria-expanded={contextOpen} onClick={() => setContextOpen((v) => !v)}>
              {contextOpen ? "Hide chat settings" : "Chat settings"}
            </Button>
          ) : null}
        </div>
      </header>

      <MeteredAiCutoffBanner orgId={orgId} errorCode={cutoffCode} compact />
      <SponsoredPromoBanner orgId={orgId} />

      {showStatusShell ? (
        <EmptyState
          soft
          className="product-hub-setup"
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          aria-busy={shell === "loading"}
        >
          <ChatStatusPrimary shell={shell} onRetry={() => void load()} connectionHref={connectionHref} />
        </EmptyState>
      ) : null}

      {!blocked ? (
      <div className="ch-layout" data-has-threads={hasSide}>
        {hasSide ? (
          <aside className="ch-sidebar" id="ch-channels" aria-label="Recent chats">
            {threads.length ? (
              <>
                <h2>Recent chats</h2>
                <ul className="ch-thread-list">
                  {threads.slice(0, 12).map((item) => (
                    <li key={item.id}>
                      <button
                        className={thread?.id === item.id ? "active" : ""}
                        type="button"
                        onClick={() => {
                          setThread(item);
                          setPreview(null);
                          setAnswerPreviews([]);
                          bg.close();
                          void load(item.id);
                        }}
                      >
                        <span>{item.scope === "team" ? "Shared" : "Private"}</span>
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {bg.runs.length ? (
              <>
                <h2>Background work</h2>
                <ul className="ch-thread-list">
                  {bg.runs.slice(0, 6).map((run) => (
                    <li key={run.id}>
                      <button
                        className={bg.selected?.run.id === run.id ? "active" : ""}
                        type="button"
                        onClick={() => {
                          setThread(null);
                          setMessages([]);
                          void bg.open(run.id);
                        }}
                      >
                        <span>{backgroundRunLabel(run)}</span>
                        {run.goal.slice(0, 70)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </aside>
        ) : null}

        <section className="ch-main" aria-label="Conversation">
          {conversationEmpty ? (
            <div className="ch-empty ask-empty">
              <h2>{aiChatShellCopy("empty").title}</h2>
              <p>{aiChatShellCopy("empty").description}</p>
              {pinned ? null : <StarterGroups availability={availability} onPick={(skillId, starter) => pickStarter(skillId, starter)} />}
              {!viewOnly ? (
                <details className="ch-privacy">
                  <summary data-disclosure>{newScope === "team" ? "This chat will be shared with your team" : "Only you will see this chat"}</summary>
                  <div className="ch-scope">
                    {AI_CHAT_SCOPE_CARDS.map((card) => (
                      <label key={card.id} className="ask-scope-option">
                        <input
                          type="radio"
                          name="ask-scope"
                          checked={newScope === card.id}
                          onChange={() => setNewScope(card.id)}
                        />
                        <span>
                          <strong>{card.title}</strong>
                          <small>{card.body}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </details>
              ) : (
                <p className="ask-viewonly-note">You&apos;re View only on this team, so your chats stay private and Ask AI won&apos;t change anything.</p>
              )}
            </div>
          ) : null}

          {thread ? (
            <>
              <header className="ch-thread-head">
                <div>
                  <span className="eyebrow">
                    {thread.scope === "team" ? "Shared with your team" : "Private chat"}
                  </span>
                  {/* The chat's name is a heading within the page, not the page's name. */}
                  <h2>{thread.title}</h2>
                </div>
                {thread.scope === "team" ? (
                  <strong className="ch-shared-banner">Every message in this chat is shared</strong>
                ) : null}
              </header>

              <div className="ch-messages" aria-live="polite">
                {messages.map((item, index) => {
                  const tools = toolRefs(item.sourceRefs);
                  const skillsUsed = skillRefs(item.sourceRefs);
                  const memoriesUsed = memoryRefs(item.sourceRefs);
                  const bridgeUsed = bridgeRefs(item.sourceRefs);
                  const usedSkill = aiSkillById(skillsUsed[0]?.toolName?.slice("skill.".length) ?? null);
                  const question = [...messages.slice(0, index)].reverse().find((m) => m.role === "user")?.content ?? lastUserQuestion;
                  const sourceCount = tools.length + memoriesUsed.length + bridgeUsed.length;
                  return (
                    <article className={`ch-msg ${item.role}`} key={item.id}>
                      <span>
                        {item.role === "assistant" ? "Ask AI" : "You"}
                        {usedSkill && item.role === "assistant" ? ` · ${usedSkill.name}` : ""}
                        {item.explicitlyShared ? " · shared" : ""}
                      </span>
                      <p className="ch-msg-body">{item.content}</p>
                      {item.role === "assistant" && (sourceCount > 0 || skillsUsed.length > 0) ? (
                        <details className="ask-sources">
                          <summary data-disclosure>What I looked at</summary>
                          <ul className="ch-provenance" aria-label="Provenance citations">
                            {skillsUsed.map((ref) => (
                              <li key={`cite-skill-${item.id}-${ref.id}`}>
                                {aiSkillById(ref.toolName!.slice("skill.".length))?.name ?? ref.toolName}
                                {ref.summary ? ` — ${ref.summary}` : ""}
                              </li>
                            ))}
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
                                {ref.summary ? ` — ${ref.summary}` : ""}
                                {ref.status === "empty" ? " (no rows)" : ""}
                              </li>
                            ))}
                            {memoriesUsed.map((ref) => (
                              <li key={`cite-mem-${item.id}-${ref.id}`}>
                                {ref.type.replace("_", " ")} · {ref.id.slice(0, 8)}
                              </li>
                            ))}
                          </ul>
                        </details>
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
                      {item.role === "assistant" && usedSkill && canSaveSkillDraft(usedSkill, role) ? (
                        <Button variant="ghost" type="button" className="ch-promote" onClick={() => void saveDraft(item, question)}>
                          Save as draft
                        </Button>
                      ) : null}
                      {item.role === "user" && thread.scope === "private" && !viewOnly ? (
                        <Button variant="ghost" type="button" className="ch-promote" onClick={() => void promote(item.id)}>
                          Promote to team memory
                        </Button>
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

              {answerPreviews.length ? (
                <div className="ask-preview-row">
                  {answerPreviews.map((row) => (
                    <SkillPreviewCard key={row.skill} preview={row} />
                  ))}
                </div>
              ) : null}

              <AiActionProposals orgId={orgId} refreshKey={messages.length} />
            </>
          ) : null}

          {bg.selected ? <BackgroundRunCard run={bg.selected.run} steps={bg.selected.steps} onClose={bg.close} /> : null}

          {preview ? (
            <SkillPreviewCard
              preview={preview}
              lead={`AI couldn't answer, but here is what ${aiSkillById(preview.skill)?.name ?? "the skill"} found in your records`}
            />
          ) : null}

          <form className="ch-composer ask-composer" onSubmit={send}>
            <div className="ask-composer-top">
              <SkillChip
                skillId={shownSkillId}
                chosenBy={pinned ? "pinned" : lastSkill ? "auto" : null}
                fromLabel={pinned && pinned === aiSkillById(initialSkill)?.id ? fromLabel : null}
                availability={availability}
                onChange={(next) => {
                  setPinned(next);
                  if (!next) setLastSkill(null);
                  setSkillNotice(null);
                }}
              />
              {skillNotice ? <small className="ask-skill-notice">{skillNotice}</small> : null}
            </div>
            {pinned && conversationEmpty ? <SkillStarters skillId={pinned} onPick={(starter) => pickStarter(null, starter)} /> : null}
            {thread?.scope === "team" ? (
              <div className="ch-composer-note">Shared with your team · teammates see this message</div>
            ) : null}
            <textarea
              ref={composerRef}
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, as in every chat app; Shift+Enter adds a new line.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                background
                  ? "Give it a goal, e.g. Summarize the bumper rules from the official manual"
                  : aiSkillById(shownSkillId)?.starters[0]
                    ? `Ask anything — e.g. ${aiSkillById(shownSkillId)!.starters[0]}`
                    : "Ask anything about your team, a match, sponsors, the robot…"
              }
            />
            <div className="ch-composer-foot">
              <label className="ask-bg-toggle">
                <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
                <span>Work on this in the background</span>
              </label>
              <Button variant="primary" type="submit" disabled={sending || bg.busy || !text.trim()}>
                {sending || bg.busy ? "Working…" : "Send"}
              </Button>
            </div>
            {notSent ? (
              <p className="ch-status ch-not-sent" role="alert">
                <strong>Not sent.</strong> {notSent} <a href={aiConnectionHref(orgId)}>Connect AI</a>
              </p>
            ) : status ? (
              <p className="ch-status" role="status">
                {status}
                {status.startsWith("Saved to your drafts") ? (
                  <>
                    {" "}
                    <a href={draftsHref}>Open drafts</a>
                  </>
                ) : null}
              </p>
            ) : null}
          </form>
        </section>

        {shell === "ready" || shell === "empty" ? (
        <aside className={`ch-context${contextOpen ? " open" : ""}`} aria-label="Chat settings">
          <nav className="ch-gov" aria-label="Chat settings links">
            <span className="ch-cache">
              Prompt caching{" "}
              <strong>{promptCachingEnabled ? "On" : "Off"}</strong>
            </span>
            <a href={`${budgetsHref}#prompt-caching`}>Manage caching</a>
            <a href={budgetsHref}>Chat limits</a>
            <a href={memoryHref}>Memory</a>
            <a href={promptsHref}>Prompts</a>
            <a href={usageHref}>Usage</a>
            <a href={runsHref}>AI runs</a>
            <a href={knowledgeHref}>Knowledge</a>
            <a href={draftsHref}>Saved drafts</a>
          </nav>
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
              <Button variant="secondary" type="button" onClick={() => void setPrivateInjection(true)}>
                Enable
              </Button>
              <Button variant="secondary" type="button" onClick={() => void setPrivateInjection(false)}>
                Disable
              </Button>
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
              <Button variant="secondary" type="submit">
                Save budget
              </Button>
            </form>
          </div>

          <div className="ch-context-block">
            <div className="ch-row">
              <strong>Team injection</strong>
              <span className={`app-badge ${memorySettings?.team?.enabled ? "good" : "setup"}`}>
                {memorySettings?.team?.enabled ? "On" : "Off"}
              </span>
            </div>
            {canManageTeam ? (
              <>
                <div className="ch-actions">
                  <Button variant="secondary" type="button" onClick={() => void setTeamInjection(true)}>
                    Enable team
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => void setTeamInjection(false)}>
                    Disable team
                  </Button>
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
                  <Button variant="secondary" type="submit">
                    Save team budget
                  </Button>
                </form>
              </>
            ) : (
              <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                An owner or admin turns team memory on. Your private memory stays yours.
              </p>
            )}
            <a href={memoryHref} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
              Open Memory →
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
              <Button variant="secondary" type="submit">
                Save private memory
              </Button>
            </form>
            <ul className="ch-memories">
              {memories.map((item) => (
                <li key={item.id}>
                  <article>
                    <small>{item.kind}</small>
                    <p>{item.content}</p>
                    <Button variant="ghost" type="button" className="ch-promote" onClick={() => void removeMemory(item.id)}>
                      Delete
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        ) : null}
      </div>
      ) : null}
    </PageMain>
  );
}
