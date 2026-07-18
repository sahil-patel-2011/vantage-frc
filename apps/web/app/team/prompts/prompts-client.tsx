"use client";

import { useEffect, useState } from "react";

type Prompt = {
  id: string;
  title: string;
  category: string;
  body: string;
  createdBy: string;
  updatedAt: string;
};

const CATEGORIES = ["general", "strategy", "scouting", "build", "outreach", "business", "cad"];

const STARTERS: Array<{ title: string; category: string; body: string }> = [
  {
    title: "Match strategy draft",
    category: "strategy",
    body: "Context: we're playing {opponent alliance} at {event}. Using our team knowledge, draft a match strategy. Tell me: our role, auto plan, teleop priorities, and endgame — as a short bulleted list.",
  },
  {
    title: "What to scout",
    category: "scouting",
    body: "Context: qualification matches at {event}. What are the 5 most decision-relevant things we should scout about our upcoming opponents? Give me a checklist we can hand to scouts.",
  },
  {
    title: "Sponsor thank-you email",
    category: "outreach",
    body: "Context: {sponsor} gave us {amount/donation}. Write a warm, specific thank-you email from our team. Result: 120 words, friendly, mentions how the support helps students.",
  },
];

export default function PromptsClient({ orgId }: { orgId: string }) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", category: "general", body: "" });
  const [message, setMessage] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/team/prompts?orgId=${orgId}`);
    const data = await response.json();
    if (response.ok) {
      setPrompts(data.prompts ?? []);
      setViewerId(data.viewerId ?? null);
      setMessage("");
    } else {
      setMessage(data.error ?? "Unable to load prompts");
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/team/prompts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...form }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Prompt saved to the library." : data.error);
    if (response.ok) {
      setForm({ title: "", category: form.category, body: "" });
      await load();
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this prompt?")) return;
    const response = await fetch(`/api/team/prompts?orgId=${orgId}&id=${id}`, { method: "DELETE" });
    const data = await response.json();
    setMessage(response.ok ? "Deleted." : data.error);
    if (response.ok) await load();
  }

  async function copy(prompt: Prompt) {
    try {
      await navigator.clipboard.writeText(prompt.body);
      setCopiedId(prompt.id);
      setTimeout(() => setCopiedId((c) => (c === prompt.id ? null : c)), 1500);
    } catch {
      setMessage("Copy failed — select the text manually.");
    }
  }

  const byCategory = prompts.reduce<Record<string, Prompt[]>>((acc, prompt) => {
    (acc[prompt.category] ??= []).push(prompt);
    return acc;
  }, {});

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI PROMPT LIBRARY</span>
          <h1>Your team&apos;s best prompts, saved</h1>
          <p className="app-muted">
            Capture the ways of asking the assistant that work well so nobody re-invents them. A good prompt
            gives <strong>context</strong>, says <strong>what you want</strong>, and describes the{" "}
            <strong>result you expect</strong>. Copy one and paste it into the{" "}
            <a href={`/chat?orgId=${orgId}`}>assistant</a>.
          </p>
        </div>
        <nav className="intel-actions" aria-label="AI links">
          <a href={`/chat?orgId=${orgId}`}>Assistant</a>
          <a href={`/team/knowledge?orgId=${orgId}`}>Team knowledge</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading prompts…</p>}

      {!loading && (
        <section className="admin-grid">
          <form className="intel-panel" onSubmit={add}>
            <span className="eyebrow">ADD A PROMPT</span>
            <label>
              Title
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              Category
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prompt
              <textarea
                required
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Context: … · Do: … · Result: …"
                style={{
                  width: "100%",
                  padding: "12px",
                  color: "#edf3f5",
                  background: "#091014",
                  border: "1px solid #3a4b54",
                  font: "13px/1.5 ui-monospace, monospace",
                  resize: "vertical",
                }}
              />
            </label>
            <button className="primary-action" type="submit">
              Save prompt
            </button>
            {!prompts.length && (
              <div style={{ marginTop: "0.75rem" }}>
                <small className="app-muted">Or start from an example:</small>
                <div className="intel-actions" style={{ marginTop: "6px" }}>
                  {STARTERS.map((s) => (
                    <button
                      type="button"
                      key={s.title}
                      onClick={() => setForm({ title: s.title, category: s.category, body: s.body })}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>

          <section className="intel-panel">
            <span className="eyebrow">LIBRARY · {prompts.length}</span>
            {!prompts.length && <p className="app-muted">No saved prompts yet. Add your first from the form.</p>}
            {Object.entries(byCategory).map(([category, list]) => (
              <div key={category}>
                <p className="eyebrow" style={{ marginTop: "1rem" }}>{category}</p>
                {list.map((prompt) => (
                  <article
                    className="admin-org"
                    style={{ display: "block", padding: "12px 0" }}
                    key={prompt.id}
                  >
                    <strong>{prompt.title}</strong>
                    <small style={{ whiteSpace: "pre-wrap", display: "block", margin: "4px 0 8px" }}>
                      {prompt.body}
                    </small>
                    <div className="intel-actions">
                      <button type="button" onClick={() => void copy(prompt)}>
                        {copiedId === prompt.id ? "Copied!" : "Copy"}
                      </button>
                      {prompt.createdBy === viewerId && (
                        <button type="button" onClick={() => void remove(prompt.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </section>
        </section>
      )}
    </main>
  );
}
