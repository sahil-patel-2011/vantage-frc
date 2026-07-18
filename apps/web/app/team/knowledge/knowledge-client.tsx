"use client";

import { useEffect, useState } from "react";

const MAX_CHARS = 20000;

function starterTemplate(teamNumber: number | null): string {
  const team = teamNumber ? `Team ${teamNumber}` : "Our team";
  return `# ${team} Knowledge

_The assistant reads this on every team chat. Keep it current — it is the fastest way to make every answer team-specific._

## About us
- Team number & name:
- Region / district:
- What we're focused on this season:

## Our robot
- Drivetrain:
- Key mechanisms (intake, shooter, climber, …):
- Known strengths:
- Known issues / things to watch:

## Strategy priorities
- What we optimize for in a match:
- Auto routine(s):
- Endgame plan:

## Conventions & preferences
- How we name things:
- Tools we use (CAD, scouting, etc.):
- Anything the AI should always assume or never do:

## Key people & contacts
- Lead mentor:
- Student leads:
`;
}

export default function KnowledgeClient({ orgId }: { orgId: string }) {
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/agent/knowledge?orgId=${orgId}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Unable to load team knowledge");
    } else {
      setMessage("");
      setContent(data.content ?? "");
      setEnabled(data.enabled ?? true);
      setTeamNumber(data.teamNumber ?? null);
      setCanEdit(Boolean(data.canEdit));
      setUpdatedAt(data.updatedAt ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save() {
    setSaving(true);
    const response = await fetch("/api/agent/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, content, enabled }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Team knowledge saved. The assistant will use it on the next team chat." : data.error);
    setSaving(false);
    if (response.ok) await load();
  }

  const title = teamNumber ? `Team ${teamNumber} Knowledge` : "Team Knowledge";
  const over = content.length > MAX_CHARS;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / TEAM KNOWLEDGE</span>
          <h1>{title}</h1>
          <p className="app-muted">
            One markdown document your whole team shares with the FRC Assistant. It is stored only for this team
            and <strong>read into every team-scope chat</strong>, so the AI always knows your robot, strategy,
            and conventions without you re-explaining them.
          </p>
        </div>
        <nav className="intel-actions" aria-label="AI links">
          <a href={`/chat?orgId=${orgId}`}>Open assistant</a>
          <a href={`/team/knowledge/history?orgId=${orgId}`}>History</a>
          <a href={`/team/prompts?orgId=${orgId}`}>Prompt library</a>
          <a href={`/team/ai-memory?orgId=${orgId}`}>AI memory</a>
          <a href={`/team/budgets?orgId=${orgId}#prompt-caching`}>Prompt caching</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading team knowledge…</p>}

      {!loading && (
        <section className="admin-grid">
          <section className="intel-panel">
            <span className="eyebrow">
              KNOWLEDGE DOCUMENT {updatedAt ? `· updated ${new Date(updatedAt).toLocaleString()}` : "· not set yet"}
            </span>
            {!canEdit && (
              <p className="app-muted">You can view this document. Owners and admins can edit it.</p>
            )}
            <textarea
              value={content}
              readOnly={!canEdit}
              onChange={(e) => setContent(e.target.value)}
              spellCheck
              style={{
                width: "100%",
                minHeight: "420px",
                marginTop: "0.75rem",
                padding: "14px",
                color: "#edf3f5",
                background: "#091014",
                border: `1px solid ${over ? "#ff6b6b" : "#3a4b54"}`,
                font: "13px/1.5 ui-monospace, monospace",
                resize: "vertical",
              }}
              placeholder="# Team knowledge…"
            />
            <p className="app-muted" style={{ color: over ? "#ff6b6b" : undefined }}>
              {content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
            </p>
            {canEdit && (
              <>
                <label className="state-control" style={{ marginTop: "0.5rem" }}>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  <span>
                    <strong>Include this document in assistant prompts</strong>
                    <small>Turn off to pause without deleting your notes.</small>
                  </span>
                </label>
                <div className="intel-actions" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={saving || over}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save knowledge"}
                  </button>
                  {!content.trim() && (
                    <button type="button" onClick={() => setContent(starterTemplate(teamNumber))}>
                      Insert starter template
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="intel-panel">
            <span className="eyebrow">GETTING GREAT ANSWERS FROM THE AI</span>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              Our assistant works best when you frame a request three ways:
            </p>
            <article className="admin-org" style={{ display: "block", padding: "12px 0" }}>
              <strong>1 · Give it context</strong>
              <small>
                Tell it about your project and needs. That is exactly what this knowledge document does
                automatically — better context, better responses.
              </small>
            </article>
            <article className="admin-org" style={{ display: "block", padding: "12px 0" }}>
              <strong>2 · Say what you want to do</strong>
              <small>State the task plainly: “draft an auto strategy for…”, “compare our climber options…”.</small>
            </article>
            <article className="admin-org" style={{ display: "block", padding: "12px 0" }}>
              <strong>3 · Describe the result you expect</strong>
              <small>Tell it the shape of the answer you want — a checklist, a table, three options with tradeoffs.</small>
            </article>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              Keep this document focused on durable facts. For per-conversation notes, use{" "}
              <a href={`/team/ai-memory?orgId=${orgId}`}>team memory</a> instead.
            </p>
          </section>
        </section>
      )}
    </main>
  );
}
