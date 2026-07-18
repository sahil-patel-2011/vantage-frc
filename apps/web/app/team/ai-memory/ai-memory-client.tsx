"use client";

import { useEffect, useState } from "react";

type TeamSettings = { enabled: boolean; tokenBudget: number; retentionDays: number };
type Counts = { active: string; expiringSoon: string; total: string };

const num = (value: unknown) => Number(value ?? 0).toLocaleString();

export default function AiMemoryClient({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<TeamSettings>({
    enabled: false,
    tokenBudget: 1600,
    retentionDays: 365,
  });
  const [counts, setCounts] = useState<Counts>({ active: "0", expiringSoon: "0", total: "0" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/agent/team-memory?orgId=${orgId}`);
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Unable to load team memory settings");
    } else {
      setMessage("");
      if (data.team) setSettings(data.team);
      if (data.counts) setCounts(data.counts);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/agent/team-memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...settings }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Team memory policy saved." : data.error);
    setSaving(false);
    if (response.ok) await load();
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI MEMORY GOVERNANCE</span>
          <h1>What the assistant remembers for the team</h1>
          <p className="app-muted">
            Team memory lets the FRC Assistant carry shared context between chats. As an admin you control
            whether it is used at all, how much of each prompt it may fill, and how long promoted memories live
            before they expire. These limits are enforced on every assistant turn.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Governance links">
          <a href={`/chat?orgId=${orgId}`}>Assistant</a>
          <a href={`/team/usage?orgId=${orgId}`}>AI usage</a>
          <a href={`/team/ai-runs?orgId=${orgId}`}>AI runs</a>
          <a href={`/team/budgets?orgId=${orgId}#prompt-caching`}>Prompt caching</a>
          <a href={`/team/budgets?orgId=${orgId}`}>API budgets</a>
          <a href={`/team/knowledge?orgId=${orgId}`}>Knowledge</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading team memory…</p>}

      {!loading && (
        <>
          <section className="metric-grid">
            <article>
              <span>Status</span>
              <strong>{settings.enabled ? "On" : "Off"}</strong>
            </article>
            <article>
              <span>Active memories</span>
              <strong>{num(counts.active)}</strong>
            </article>
            <article>
              <span>Expiring ≤ 7d</span>
              <strong>{num(counts.expiringSoon)}</strong>
            </article>
            <article>
              <span>Total stored</span>
              <strong>{num(counts.total)}</strong>
            </article>
          </section>

          <form className="intel-panel auth-policy-form" onSubmit={save} style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">TEAM MEMORY POLICY</span>
            <label className="state-control">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span>
                <strong>Use team memory in assistant prompts</strong>
                <small>When off, no shared team memory is injected — private per-user memory is unaffected.</small>
              </span>
            </label>
            <label>
              Retention window (days)
              <input
                type="number"
                min={1}
                max={3650}
                value={settings.retentionDays}
                onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
              />
              <small>Promoted team memories are ignored once older than this. 1–3650 days.</small>
            </label>
            <label>
              Per-prompt token budget
              <input
                type="number"
                min={0}
                max={10000}
                value={settings.tokenBudget}
                onChange={(e) => setSettings({ ...settings, tokenBudget: Number(e.target.value) })}
              />
              <small>Maximum tokens of team memory the assistant may add to any single prompt. 0–10000.</small>
            </label>
            <button className="primary-action" disabled={saving}>
              {saving ? "Saving…" : "Save team memory policy"}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
