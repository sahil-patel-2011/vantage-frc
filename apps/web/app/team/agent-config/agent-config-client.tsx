"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AGENT_CONFIG_KINDS,
  validateAgentConfigContent,
  validateAgentConfigName,
  type AgentConfigKind,
} from "../../../lib/agent-config/formats";
import type { AgentConfigItem, AgentConfigRevision } from "../../../lib/agent-config/store";
import type { AgentConfigView } from "../../api/agent-config/route";
import "./agent-config.css";

const KIND_LABEL: Record<AgentConfigKind, string> = {
  rules: "Rules",
  subagent: "Subagents",
  "mcp-server": "MCP servers",
  permissions: "Permissions",
  skill: "Skills",
};

const KIND_CHEATSHEET: Record<AgentConfigKind, { hint: string; example: string }> = {
  rules: {
    hint: "Plain markdown appended to every member's agent context (imported into CLAUDE.md by sync; written as a .cursor/rules .mdc for Cursor). Optionally start with a ---description/globs/alwaysApply--- frontmatter block to scope the Cursor rule to matching files; without it the rule is always-on.",
    example: `- Always use meters — never inches — in robot code and CAD discussion.
- SparkMax current limits are mandatory on every motor controller.
- Subsystems are named <Mechanism>Subsystem (e.g. ShooterSubsystem).`,
  },
  subagent: {
    hint: "Claude Code subagent file: YAML frontmatter {name, description, tools?, model?} then the system prompt body. Synced to .claude/agents/<name>.md.",
    example: `---
name: drivetrain-reviewer
description: Reviews drivetrain code for unit and current-limit mistakes
tools: Read, Grep, Glob
---

You review FRC drivetrain code. Flag any imperial units and any motor
controller configured without a current limit.`,
  },
  "mcp-server": {
    hint: "One .mcp.json mcpServers entry: {\"command\", \"args\", \"env\"} for stdio or {\"url\"} for remote. Never paste real keys — use ${PLACEHOLDER} values members set locally. Synced under the vantage- prefix.",
    example: `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
}`,
  },
  permissions: {
    hint: "settings.json permissions arrays. Sync writes these to .claude/vantage-permissions.suggested.json only — a human merges them, never automation.",
    example: `{
  "allow": ["Bash(./gradlew build)", "Bash(./gradlew test)"],
  "deny": ["Bash(rm -rf *)"]
}`,
  },
  skill: {
    hint: "SKILL.md format: frontmatter {name, description} then the skill instructions. Synced to .claude/skills/<name>/SKILL.md.",
    example: `---
name: match-strategy-notes
description: How this team writes pre-match strategy notes
---

When drafting strategy notes, always list our alliance partners'
autonomous routines first, then scoring estimates.`,
  },
};

type Live = Extract<AgentConfigView, { status: "live" }>;

type EditorState = {
  itemId: string | null;
  kind: AgentConfigKind;
  name: string;
  description: string;
  content: string;
};

const EMPTY_EDITOR: EditorState = { itemId: null, kind: "rules", name: "", description: "", content: "" };

export default function AgentConfigClient() {
  const [view, setView] = useState<AgentConfigView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [revisions, setRevisions] = useState<AgentConfigRevision[] | null>(null);

  const live: Live | null = view && view.status === "live" ? view : null;
  const orgId = live?.orgId ?? null;

  const load = useCallback(() => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    void fetch(`/api/agent-config${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AgentConfigView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    (payload: Record<string, unknown>, onDone?: (data: Record<string, unknown>) => void) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      void fetch("/api/agent-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as Record<string, unknown>;
          if (!response.ok) {
            setError(typeof data.error === "string" ? data.error : "Something went wrong.");
            return;
          }
          if (data.view && typeof data.view === "object") setView(data.view as AgentConfigView);
          onDone?.(data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  // Live validation is the same pure validator the server runs before saving.
  const nameProblems = useMemo(
    () => (editor.name ? validateAgentConfigName(editor.name.toLowerCase()).problems : []),
    [editor.name],
  );
  const contentProblems = useMemo(
    () => (editor.content ? validateAgentConfigContent(editor.kind, editor.content).problems : []),
    [editor.kind, editor.content],
  );
  const problems = [...nameProblems, ...contentProblems];

  const openItem = useCallback((item: AgentConfigItem) => {
    setEditor({
      itemId: item.id,
      kind: item.kind,
      name: item.name,
      description: item.description ?? "",
      content: item.content,
    });
    setRevisions(null);
    setNotice("");
  }, []);

  const save = useCallback(() => {
    mutate(
      {
        action: "save-item",
        kind: editor.kind,
        name: editor.name.toLowerCase(),
        description: editor.description || null,
        content: editor.content,
      },
      (data) => {
        const saved = data.saved as { item?: AgentConfigItem; problems?: string[] } | undefined;
        if (saved?.item) {
          setEditor((current) => ({ ...current, itemId: saved.item!.id }));
          setNotice(
            saved.problems?.length
              ? "Saved as draft — it stays out of sync bundles until the problems above are fixed."
              : `Saved v${saved.item.version}. Every member picks it up on their next sync.`,
          );
        }
      },
    );
  }, [mutate, editor]);

  const loadRevisions = useCallback(() => {
    if (!editor.itemId) return;
    mutate({ action: "revisions", itemId: editor.itemId }, (data) => {
      setRevisions(Array.isArray(data.revisions) ? (data.revisions as AgentConfigRevision[]) : []);
    });
  }, [mutate, editor.itemId]);

  if (fetchFailed) {
    return (
      <main className="module-page">
        <p className="telemetry-status" role="alert">
          Could not load agent configuration. Check your connection and try again.
        </p>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page">
        <p aria-busy="true">Loading team agent configuration…</p>
      </main>
    );
  }

  if (view.status !== "live") {
    return (
      <main className="module-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Agent config</span>
            <h1>Team agent configuration</h1>
            <p>{view.message}</p>
          </div>
        </header>
      </main>
    );
  }

  const bundleUrl = `/api/agent-config/bundle?orgId=${encodeURIComponent(view.orgId)}`;
  const cheat = KIND_CHEATSHEET[editor.kind];
  // Sharing state always comes from the freshly-loaded view (mutations refresh it).
  const currentItem = editor.itemId ? view.items.find((item) => item.id === editor.itemId) ?? null : null;
  const grantableMembers = currentItem
    ? view.members.filter((member) => member.userId !== currentItem.createdBy)
    : [];

  const setSharing = (visibility: "team" | "members", userIds: string[], doneNotice: string) =>
    mutate({ action: "set-sharing", itemId: editor.itemId, visibility, userIds }, () =>
      setNotice(doneNotice),
    );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Agent config</span>
          <h1>Team agent configuration</h1>
          <p>
            Author your coding-agent setup once — rules, subagents, MCP servers, permissions, skills — and
            every member&apos;s agent uses it: Claude Code and Cursor via one sync command, custom agents via
            the bundle export, and Vantage&apos;s own in-app agent automatically. Each item is shared with the
            entire team or with just the people you pick.
          </p>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="agent-config-ok">{notice}</p> : null}

      <div className="agent-config-grid">
        <section className="agent-config-panel" aria-label="Shared configuration items">
          <h2>Shared items</h2>
          {view.canEdit ? (
            <div className="agent-config-actions">
              <button type="button" onClick={() => { setEditor(EMPTY_EDITOR); setRevisions(null); }}>
                + New item
              </button>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--app-muted)" }}>
              You can read the team config. Editing is limited to owners/admins
              {view.allowMemberEdits ? "" : " (member edits are off)"}.
            </p>
          )}
          {AGENT_CONFIG_KINDS.map((kind) => {
            const items = view.items.filter((item) => item.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind}>
                <h3>{KIND_LABEL[kind]}</h3>
                <ul className="agent-config-items">
                  {items.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => openItem(item)} aria-current={editor.itemId === item.id}>
                        <span>
                          {item.name}
                          {item.description ? <small>{item.description}</small> : null}
                        </span>
                        <span className="agent-config-badges">
                          {item.visibility === "members" ? (
                            <span className="app-badge setup">
                              {item.sharedWith.length
                                ? `shared with ${item.sharedWith.length}`
                                : "creator + admins only"}
                            </span>
                          ) : null}
                          <span className={`app-badge${item.formatValid ? " good" : " setup"}`}>
                            {item.formatValid ? `v${item.version}` : "invalid — excluded from sync"}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {view.items.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--app-muted)" }}>
              Nothing shared yet. Start with a <b>rules</b> item — one markdown list of the conventions every
              agent on the team must follow.
            </p>
          ) : null}

          {view.role === "owner" || view.role === "admin" ? (
            <label className="agent-config-toggle">
              <input
                type="checkbox"
                checked={view.allowMemberEdits}
                disabled={busy}
                onChange={(event) =>
                  mutate({ action: "set-allow-member-edits", allowMemberEdits: event.target.checked })
                }
              />
              Allow all members to edit (not just owners/admins)
            </label>
          ) : null}
        </section>

        <section className="agent-config-panel" aria-label="Editor">
          <h2>{editor.itemId ? `Edit ${editor.name}` : "New item"}</h2>
          <div className="agent-config-editor">
            <label>
              Kind
              <select
                value={editor.kind}
                disabled={Boolean(editor.itemId)}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, kind: event.target.value as AgentConfigKind }))
                }
              >
                {AGENT_CONFIG_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name (lowercase, hyphens — becomes the filename)
              <input
                value={editor.name}
                disabled={Boolean(editor.itemId)}
                placeholder="e.g. units-and-conventions"
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label>
              Description (optional)
              <input
                value={editor.description}
                onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
            <label>
              Content
              <textarea
                value={editor.content}
                spellCheck={false}
                onChange={(event) => setEditor((current) => ({ ...current, content: event.target.value }))}
              />
            </label>

            {editor.content && problems.length ? (
              <ul className="agent-config-problems" role="alert">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {editor.content && !problems.length ? <p className="agent-config-ok">Format looks valid.</p> : null}

            <details className="agent-config-cheatsheet">
              <summary>Format cheat-sheet: {KIND_LABEL[editor.kind]}</summary>
              <p style={{ fontSize: 12, color: "var(--app-muted)" }}>{cheat.hint}</p>
              <pre>{cheat.example}</pre>
            </details>

            {view.canEdit ? (
              <div className="agent-config-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !editor.name || !editor.content || nameProblems.length > 0}
                  onClick={save}
                >
                  {problems.length ? "Save draft (invalid)" : "Save"}
                </button>
                {editor.itemId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete ${editor.name}? History is removed with it.`)) return;
                      mutate({ action: "delete-item", itemId: editor.itemId }, () => setEditor(EMPTY_EDITOR));
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}

            {currentItem ? (
              view.sharingReady ? (
                <fieldset className="agent-config-sharing">
                  <legend>Who can use this item</legend>
                  <label className="agent-config-share-choice">
                    <input
                      type="radio"
                      name="agent-config-visibility"
                      checked={currentItem.visibility === "team"}
                      disabled={busy || !view.canEdit}
                      onChange={() => setSharing("team", [], "Shared with the entire team.")}
                    />
                    Entire team
                  </label>
                  <label className="agent-config-share-choice">
                    <input
                      type="radio"
                      name="agent-config-visibility"
                      checked={currentItem.visibility === "members"}
                      disabled={busy || !view.canEdit}
                      onChange={() =>
                        setSharing("members", currentItem.sharedWith, "Restricted — pick people below.")
                      }
                    />
                    Only specific people
                  </label>
                  {currentItem.visibility === "members" ? (
                    <>
                      <p className="agent-config-share-note">
                        The creator and team owners/admins can always see and manage this item, but only the
                        creator and the people picked here get it in their sync bundles.
                      </p>
                      {grantableMembers.length === 0 ? (
                        <p className="agent-config-share-note">
                          No other members to pick yet — invite teammates first.
                        </p>
                      ) : (
                        <ul className="agent-config-share-members">
                          {grantableMembers.map((member) => {
                            const granted = currentItem.sharedWith.includes(member.userId);
                            return (
                              <li key={member.userId}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={granted}
                                    disabled={busy || !view.canEdit}
                                    onChange={() =>
                                      setSharing(
                                        "members",
                                        granted
                                          ? currentItem.sharedWith.filter((id) => id !== member.userId)
                                          : [...currentItem.sharedWith, member.userId],
                                        granted
                                          ? `No longer shared with ${member.name}.`
                                          : `Shared with ${member.name}.`,
                                      )
                                    }
                                  />
                                  <span>
                                    {member.name}
                                    {member.userId === view.userId ? " (you)" : ""}
                                    {member.role !== "member" ? (
                                      <small> {member.role} — already sees it; picking adds it to their sync</small>
                                    ) : null}
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  ) : null}
                </fieldset>
              ) : (
                <p className="agent-config-share-note">
                  Per-person sharing is not available yet on this server (migration 0490 has not run) — every
                  item is shared with the entire team.
                </p>
              )
            ) : null}

            {editor.itemId ? (
              <details className="agent-config-revisions" onToggle={(event) => {
                if ((event.target as HTMLDetailsElement).open && revisions === null) loadRevisions();
              }}>
                <summary>Revision history</summary>
                {revisions === null ? (
                  <p style={{ fontSize: 12, color: "var(--app-muted)" }}>Loading…</p>
                ) : revisions.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--app-muted)" }}>No revisions recorded yet.</p>
                ) : (
                  <ul>
                    {revisions.map((revision) => (
                      <li key={revision.id}>
                        <span>
                          v{revision.version} · {new Date(revision.createdAt).toLocaleString()}
                        </span>
                        {view.canEdit ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              mutate(
                                { action: "restore-revision", itemId: editor.itemId, revisionId: revision.id },
                                (data) => {
                                  const saved = data.saved as { item?: AgentConfigItem } | undefined;
                                  if (saved?.item) {
                                    openItem(saved.item);
                                    setNotice(`Restored v${revision.version} as new v${saved.item.version}.`);
                                  }
                                },
                              )
                            }
                          >
                            Restore
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            ) : null}
          </div>
        </section>
      </div>

      <section className="agent-config-panel agent-config-howto" style={{ marginTop: 16 }} aria-label="How to use">
        <h2>How every member uses this</h2>
        <h3>Claude Code (one command, run in your robot-code repo)</h3>
        <pre>{`vantage-cad agent sync            # writes .claude/agents, team rules + CLAUDE.md import, .mcp.json (vantage-* only)
vantage-cad agent sync --dry-run  # preview without writing`}</pre>
        <p style={{ fontSize: 12, color: "var(--app-muted)" }}>
          Requires one-time pairing via <code>vantage-cad setup</code>. Permissions are never auto-applied —
          sync writes <code>.claude/vantage-permissions.suggested.json</code> for a human to review.
        </p>
        <h3>Cursor (same command, Cursor-native formats)</h3>
        <pre>{`vantage-cad agent sync --agent cursor  # rules → .cursor/rules/vantage/*.mdc, skills → .cursor/skills, MCP → .cursor/mcp.json
vantage-cad agent sync --agent all     # Claude Code + Cursor together`}</pre>
        <p style={{ fontSize: 12, color: "var(--app-muted)" }}>
          Without <code>--agent</code>, sync targets whatever the repo already uses (a <code>.cursor/</code>{" "}
          folder enables Cursor). Rules without path scopes become always-on (<code>alwaysApply: true</code>);
          a rule starting with a <code>globs:</code> frontmatter block becomes auto-attached to matching
          files. Only files Vantage generated (inside <code>.cursor/rules/vantage/</code>, marked with a
          banner) are ever updated or removed. Subagents and permissions have no Cursor equivalent and are
          skipped.
        </p>
        <h3>Any custom agent (typed JSON export)</h3>
        <pre>{`GET ${bundleUrl}
GET ${bundleUrl}&format=cursor   # same content materialized as Cursor-native files`}</pre>
        <p style={{ fontSize: 12, color: "var(--app-muted)" }}>
          Session-authenticated and org-scoped; the shape is documented in <code>docs/AGENT_CONFIG.md</code>.
          Every export is also scoped to the requesting member: team-wide items plus items shared with them.
        </p>
        <h3>Vantage in-app agent</h3>
        <p style={{ fontSize: 12, color: "var(--app-muted)" }}>
          Valid <b>rules</b> items are injected into every in-app AI run automatically, labeled as
          &quot;Team agent rules&quot; in the run&apos;s context sources.
        </p>
      </section>
    </main>
  );
}
