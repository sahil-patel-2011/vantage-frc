"use client";

import { useRef, useState } from "react";
import { Button, Modal, askConfirm } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

export type ChatMemory = { id: string; kind: string; content: string; disabledAt: string | null };
export type ChatMemorySettings = {
  private: { enabled: boolean; tokenBudget: number };
  team: { enabled: boolean; tokenBudget: number; retentionDays: number } | null;
};

/**
 * Ask AI's "Chat settings": links to the AI admin pages, and private / team memory injection with
 * their token budgets. Owns its own form state; `reload` refreshes the chat's data after a save.
 */
export function ChatSettingsDialog({
  open,
  onClose,
  orgId,
  memories,
  memorySettings,
  promptCachingEnabled,
  canManageTeam,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  memories: ChatMemory[];
  memorySettings: ChatMemorySettings | null;
  promptCachingEnabled: boolean;
  canManageTeam: boolean;
  /** Reloads the chat's data quietly; throws when it couldn't. */
  reload: () => Promise<void>;
}) {
  const [memory, setMemory] = useState("");
  const [privateBudget, setPrivateBudget] = useState(memorySettings?.private?.tokenBudget ?? 1200);
  const [teamBudget, setTeamBudget] = useState(memorySettings?.team?.tokenBudget ?? 1600);
  // New settings from the server reset the budget fields, as a fresh load did before.
  const [seenSettings, setSeenSettings] = useState(memorySettings);
  if (seenSettings !== memorySettings) {
    setSeenSettings(memorySettings);
    if (memorySettings) {
      setPrivateBudget(memorySettings.private?.tokenBudget ?? 1200);
      setTeamBudget(memorySettings.team?.tokenBudget ?? 1600);
    }
  }
  const [memoryBusy, setMemoryBusy] = useState(false);
  const memoryPending = useRef(false);
  const [memoryNotice, setMemoryNotice] = useState<{ text: string; error: boolean } | null>(null);

  const budgetsHref = hubHref("/ai", "budgets", orgId);
  const memoryHref = hubHref("/ai", "memory", orgId);
  const knowledgeHref = withOrgHref("/team?tab=knowledge", orgId);
  const usageHref = hubHref("/ai", "usage", orgId);
  const runsHref = withOrgHref("/team/ai-runs", orgId);
  const promptsHref = withOrgHref("/team/prompts", orgId);
  const draftsHref = hubHref("/ai", "writer", orgId);

  async function updateMemory(body: Record<string, unknown> | string, success: string): Promise<boolean> {
    if (memoryPending.current) return false;
    memoryPending.current = true;
    setMemoryBusy(true);
    setMemoryNotice({ text: "Saving…", error: false });
    try {
      const response = typeof body === "string"
        ? await fetch(`/api/agent/memory?id=${encodeURIComponent(body)}`, { method: "DELETE" })
        : await fetch("/api/agent/memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, orgId }) });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "That change couldn't be saved. Try again.");
      }
      try {
        await reload();
        setMemoryNotice({ text: success, error: false });
      } catch {
        // The mutation succeeded. Do not leave saved text in the input and invite a duplicate.
        setMemoryNotice({ text: `${success} The latest settings couldn't reload. Reopen this chat to refresh them.`, error: true });
      }
      return true;
    } catch (error) {
      setMemoryNotice({ text: error instanceof Error ? error.message : "That change couldn't be saved. Try again.", error: true });
      return false;
    } finally {
      memoryPending.current = false;
      setMemoryBusy(false);
    }
  }

  async function saveMemory(event: React.FormEvent) {
    event.preventDefault();
    if (await updateMemory({ action: "save", kind: "preference", content: memory }, "Private memory saved.")) setMemory("");
  }

  async function removeMemory(id: string) {
    if (!(await askConfirm({ title: "Delete this private memory?", body: "This cannot be undone.", confirmLabel: "Delete private memory", tone: "destructive" }))) return;
    await updateMemory(id, "Private memory deleted.");
  }

  async function setPrivateInjection(enabled: boolean) {
    await updateMemory({ action: "toggle-private", enabled, tokenBudget: privateBudget }, enabled ? "Private memory enabled." : "Private memory disabled.");
  }

  async function savePrivateBudget(event: React.FormEvent) {
    event.preventDefault();
    await updateMemory({ action: "private-budget", enabled: memorySettings?.private.enabled ?? true, tokenBudget: privateBudget }, `Private memory budget set to ${privateBudget} tokens.`);
  }

  async function setTeamInjection(enabled: boolean) {
    await updateMemory({
        action: "toggle-team",
        enabled,
        tokenBudget: teamBudget,
        retentionDays: memorySettings?.team?.retentionDays ?? 365,
      }, enabled ? "Team memory enabled." : "Team memory disabled.");
  }

  async function saveTeamBudget(event: React.FormEvent) {
    event.preventDefault();
    await updateMemory({
        action: "team-budget",
        enabled: memorySettings?.team?.enabled ?? false,
        tokenBudget: teamBudget,
        retentionDays: memorySettings?.team?.retentionDays ?? 365,
      }, `Team memory budget set to ${teamBudget} tokens.`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Chat settings" className="ch-settings-dialog">
      {memoryNotice ? <p className={`ch-status${memoryNotice.error ? " ch-not-sent" : ""}`} role={memoryNotice.error ? "alert" : "status"}>{memoryNotice.text}</p> : null}
      <fieldset className="ch-settings-content" disabled={memoryBusy} aria-busy={memoryBusy}>
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
          <label className="ask-memory-toggle"><input type="checkbox" checked={memorySettings?.private.enabled !== false} onChange={event => void setPrivateInjection(event.target.checked)} /> Use private memory in answers</label>
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
              <label className="ask-memory-toggle"><input type="checkbox" checked={memorySettings?.team?.enabled === true} onChange={event => void setTeamInjection(event.target.checked)} /> Use team memory in answers</label>
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
        </div>

        <div className="ch-context-block">
          <span className="eyebrow">Your private memory</span>
          <form className="ch-budget" onSubmit={saveMemory}>
            <textarea
              aria-label="New private memory"
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
      </fieldset>
    </Modal>
  );
}
