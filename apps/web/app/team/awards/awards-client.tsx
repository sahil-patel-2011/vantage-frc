"use client";
import { useEffect, useState } from "react";
import { AWARD_CATALOG, awardCatalogEntry } from "../../../lib/awards";

type Submission = {
  id: string; seasonYear: number; awardType: string; status: string; totalItems: number; doneItems: number;
};
type Item = { id: string; prompt: string | null; content: string | null; charLimit: number | null };

const STATUSES = ["planned", "drafting", "in_review", "submitted", "finalist", "won", "not_selected"];

export default function AwardsClient({ orgId }: { orgId: string }) {
  const seasonYear = new Date().getFullYear();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ awardType: AWARD_CATALOG[0]!.slug, eventKey: "", deadline: "" });

  async function load() {
    const response = await fetch(`/api/awards?orgId=${orgId}`);
    const data = await response.json();
    setSubmissions(data.submissions ?? []);
    if (!response.ok) setMessage(data.error);
  }
  useEffect(() => { void load(); }, [orgId]);

  async function loadItems(submissionId: string) {
    setSelectedId(submissionId);
    const response = await fetch(`/api/awards/items?orgId=${orgId}&submissionId=${submissionId}`);
    const data = await response.json();
    setItems(data.items ?? []);
  }

  async function addSubmission(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/awards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, seasonYear, ...form }) });
    const data = await response.json();
    setMessage(response.ok ? "Award submission started — essay prompts pre-loaded." : data.error);
    if (response.ok) { setForm({ awardType: AWARD_CATALOG[0]!.slug, eventKey: "", deadline: "" }); await load(); }
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch("/api/awards", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, status }) });
    const data = await response.json();
    setMessage(response.ok ? "Status updated." : data.error);
    if (response.ok) await load();
  }

  async function saveItem(id: string, content: string) {
    await fetch("/api/awards/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, content }) });
    if (selectedId) await loadItems(selectedId);
  }

  const selected = submissions.find((s) => s.id === selectedId) ?? null;
  const totalWon = submissions.filter((s) => s.status === "won").length;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / AWARDS</span><h1>FIRST award submissions</h1></div>
        <nav className="intel-actions"><a href={`/team/grants?orgId=${orgId}`}>Grants</a><a href={`/team?orgId=${orgId}`}>Team controls →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      <section className="metric-grid">
        <article><span>Submissions this season</span><strong>{submissions.filter((s) => s.seasonYear === seasonYear).length}</strong></article>
        <article><span>Won (tracked)</span><strong>{totalWon}</strong></article>
        <article><span>In progress</span><strong>{submissions.filter((s) => !["won", "not_selected"].includes(s.status)).length}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addSubmission}>
          <span className="eyebrow">START AN AWARD SUBMISSION</span>
          <label>Award<select value={form.awardType} onChange={(e) => setForm({ ...form, awardType: e.target.value })}>{AWARD_CATALOG.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}</select></label>
          <p>{awardCatalogEntry(form.awardType)?.description}</p>
          <label>Event (optional)<input value={form.eventKey} onChange={(e) => setForm({ ...form, eventKey: e.target.value })} placeholder="2027mnmin" /></label>
          <label>Deadline<input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></label>
          <button className="primary-action">Start submission</button>
        </form>
        <section className="intel-panel invite-list">
          <span className="eyebrow">SUBMISSIONS</span>
          {submissions.map((s) => (
            <article key={s.id} onClick={() => void loadItems(s.id)} style={{ cursor: "pointer" }}>
              <div><strong>{awardCatalogEntry(s.awardType)?.name ?? s.awardType}</strong><small>{s.seasonYear} · {s.status} · {s.doneItems}/{s.totalItems} items done</small></div>
              <select value={s.status} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); void updateStatus(s.id, e.target.value); }}>
                {STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
            </article>
          ))}
        </section>
      </section>

      {selected && (
        <section className="intel-panel">
          <span className="eyebrow">{(awardCatalogEntry(selected.awardType)?.name ?? selected.awardType).toUpperCase()} — ESSAY ITEMS</span>
          {items.map((item) => (
            <article key={item.id}>
              {item.prompt && <p>{item.prompt}</p>}
              <textarea rows={5} defaultValue={item.content ?? ""} onBlur={(e) => void saveItem(item.id, e.target.value)} maxLength={item.charLimit ?? undefined} />
              {item.charLimit && <small>{item.content?.length ?? 0}/{item.charLimit} characters</small>}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
