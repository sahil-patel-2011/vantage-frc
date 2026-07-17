"use client";
import { useEffect, useState } from "react";

type Opportunity = { id: string; name: string; funder: string | null; amountMinUsd: string | null; amountMaxUsd: string | null; deadline: string | null };
type Application = { id: string; opportunityName: string | null; seasonYear: number; status: string; amountRequestedUsd: string | null; amountAwardedUsd: string | null };
type Item = { id: string; kind: string; prompt: string | null; content: string | null; charLimit: number | null; done: boolean };
type Draft = { subject: string; body: string };

const STATUSES = ["identified", "drafting", "in_review", "submitted", "awarded", "declined"];

export default function GrantsClient({ orgId }: { orgId: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [oppForm, setOppForm] = useState({ name: "", funder: "", description: "", amountMinUsd: "", amountMaxUsd: "", deadline: "", applicationUrl: "" });
  const [appForm, setAppForm] = useState({ grantOpportunityId: "", amountRequestedUsd: "" });
  const [itemForm, setItemForm] = useState({ kind: "essay", prompt: "", charLimit: "" });

  async function load() {
    const [oppRes, appRes] = await Promise.all([
      fetch(`/api/grants/opportunities?orgId=${orgId}`),
      fetch(`/api/grants/applications?orgId=${orgId}`),
    ]);
    const oppData = await oppRes.json();
    const appData = await appRes.json();
    setOpportunities(oppData.opportunities ?? []);
    setApplications(appData.applications ?? []);
    if (!oppRes.ok) setMessage(oppData.error);
  }
  useEffect(() => { void load(); }, [orgId]);

  async function loadItems(applicationId: string) {
    setSelectedId(applicationId);
    setDraft(null);
    const response = await fetch(`/api/grants/items?orgId=${orgId}&applicationId=${applicationId}`);
    const data = await response.json();
    setItems(data.items ?? []);
  }

  async function addOpportunity(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/grants/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, ...oppForm }) });
    const data = await response.json();
    setMessage(response.ok ? "Grant opportunity added." : data.error);
    if (response.ok) { setOppForm({ name: "", funder: "", description: "", amountMinUsd: "", amountMaxUsd: "", deadline: "", applicationUrl: "" }); await load(); }
  }

  async function startApplication(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/grants/applications", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, seasonYear: new Date().getFullYear(), grantOpportunityId: appForm.grantOpportunityId || null, amountRequestedUsd: appForm.amountRequestedUsd || null }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Application started." : data.error);
    if (response.ok) { setAppForm({ grantOpportunityId: "", amountRequestedUsd: "" }); await load(); }
  }

  async function updateStatus(id: string, status: string) {
    const response = await fetch("/api/grants/applications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, status }) });
    const data = await response.json();
    setMessage(response.ok ? "Status updated." : data.error);
    if (response.ok) await load();
  }

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/grants/items", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, applicationId: selectedId, kind: itemForm.kind, prompt: itemForm.prompt, charLimit: itemForm.charLimit || null }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Item added." : data.error);
    if (response.ok) { setItemForm({ kind: "essay", prompt: "", charLimit: "" }); await loadItems(selectedId); }
  }

  async function saveItem(id: string, content: string) {
    await fetch("/api/grants/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, content }) });
  }

  async function toggleDone(id: string, done: boolean) {
    await fetch("/api/grants/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, done }) });
    if (selectedId) await loadItems(selectedId);
  }

  async function draftFollowup() {
    if (!selectedId) return;
    const response = await fetch("/api/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, kind: "grant_followup", grantApplicationId: selectedId }) });
    const data = await response.json();
    if (response.ok) setDraft(data.message); else setMessage(data.error);
  }

  const selectedApp = applications.find((a) => a.id === selectedId) ?? null;
  const totalAwarded = applications.filter((a) => a.status === "awarded").reduce((sum, a) => sum + Number(a.amountAwardedUsd ?? 0), 0);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / GRANTS</span><h1>Grant tracker &amp; writing workspace</h1></div>
        <nav className="intel-actions"><a href={`/team/sponsors?orgId=${orgId}`}>Sponsors</a><a href={`/team/awards?orgId=${orgId}`}>Awards</a><a href={`/team?orgId=${orgId}`}>Team controls →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      <section className="metric-grid">
        <article><span>Open applications</span><strong>{applications.filter((a) => !["awarded", "declined"].includes(a.status)).length}</strong></article>
        <article><span>Awarded</span><strong>{applications.filter((a) => a.status === "awarded").length}</strong></article>
        <article><span>Total awarded</span><strong>${totalAwarded.toLocaleString()}</strong></article>
        <article><span>Grant sources tracked</span><strong>{opportunities.length}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addOpportunity}>
          <span className="eyebrow">TRACK A GRANT OPPORTUNITY</span>
          <label>Name<input required value={oppForm.name} onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })} placeholder="NASA HUNCH robotics grant" /></label>
          <label>Funder<input value={oppForm.funder} onChange={(e) => setOppForm({ ...oppForm, funder: e.target.value })} /></label>
          <div className="budget-fields">
            <label>Min amount ($)<input type="number" min="0" value={oppForm.amountMinUsd} onChange={(e) => setOppForm({ ...oppForm, amountMinUsd: e.target.value })} /></label>
            <label>Max amount ($)<input type="number" min="0" value={oppForm.amountMaxUsd} onChange={(e) => setOppForm({ ...oppForm, amountMaxUsd: e.target.value })} /></label>
          </div>
          <label>Deadline<input type="date" value={oppForm.deadline} onChange={(e) => setOppForm({ ...oppForm, deadline: e.target.value })} /></label>
          <label>Application URL<input type="url" value={oppForm.applicationUrl} onChange={(e) => setOppForm({ ...oppForm, applicationUrl: e.target.value })} /></label>
          <label>Notes<input value={oppForm.description} onChange={(e) => setOppForm({ ...oppForm, description: e.target.value })} /></label>
          <button className="primary-action">Save opportunity</button>
        </form>
        <section className="intel-panel invite-list">
          <span className="eyebrow">GRANT OPPORTUNITIES</span>
          {opportunities.map((o) => (
            <article key={o.id}>
              <div><strong>{o.name}</strong><small>{o.funder} · {o.deadline ? new Date(o.deadline).toLocaleDateString() : "no deadline"} · {o.amountMinUsd || o.amountMaxUsd ? `$${o.amountMinUsd ?? "?"}–$${o.amountMaxUsd ?? "?"}` : ""}</small></div>
            </article>
          ))}
        </section>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={startApplication}>
          <span className="eyebrow">START AN APPLICATION</span>
          <label>Opportunity<select value={appForm.grantOpportunityId} onChange={(e) => setAppForm({ ...appForm, grantOpportunityId: e.target.value })}><option value="">Not linked / general grant</option>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Amount requested ($)<input type="number" min="0" value={appForm.amountRequestedUsd} onChange={(e) => setAppForm({ ...appForm, amountRequestedUsd: e.target.value })} /></label>
          <button className="primary-action">Start application</button>
        </form>
        <section className="intel-panel invite-list">
          <span className="eyebrow">APPLICATIONS</span>
          {applications.map((a) => (
            <article key={a.id} onClick={() => void loadItems(a.id)} style={{ cursor: "pointer" }}>
              <div><strong>{a.opportunityName ?? "General grant application"}</strong><small>{a.seasonYear} · {a.status}{a.amountRequestedUsd ? ` · $${Number(a.amountRequestedUsd).toLocaleString()} requested` : ""}</small></div>
              <select value={a.status} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); void updateStatus(a.id, e.target.value); }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </article>
          ))}
        </section>
      </section>

      {selectedApp && (
        <section className="compare-panel">
          <span className="eyebrow">{(selectedApp.opportunityName ?? "APPLICATION").toUpperCase()} — ITEMS</span>
          <div className="intel-panel">
            {items.map((item) => (
              <article key={item.id}>
                <div><strong>{item.kind}</strong>{item.prompt && <small>{item.prompt}</small>}</div>
                <textarea rows={4} defaultValue={item.content ?? ""} onBlur={(e) => void saveItem(item.id, e.target.value)} maxLength={item.charLimit ?? undefined} />
                {item.charLimit && <small>{item.content?.length ?? 0}/{item.charLimit} characters</small>}
                <label className="check-field"><input type="checkbox" checked={item.done} onChange={(e) => void toggleDone(item.id, e.target.checked)} /> Done</label>
              </article>
            ))}
            <form onSubmit={addItem}>
              <label>Kind<select value={itemForm.kind} onChange={(e) => setItemForm({ ...itemForm, kind: e.target.value })}><option value="essay">Essay</option><option value="question">Question</option><option value="attachment">Attachment</option></select></label>
              <label>Prompt<input value={itemForm.prompt} onChange={(e) => setItemForm({ ...itemForm, prompt: e.target.value })} /></label>
              <label>Character limit<input type="number" min="0" value={itemForm.charLimit} onChange={(e) => setItemForm({ ...itemForm, charLimit: e.target.value })} /></label>
              <button className="primary-action">Add item</button>
            </form>
          </div>
          <div className="intel-panel">
            <span className="eyebrow">DRAFT A FOLLOW-UP EMAIL</span>
            <button onClick={() => void draftFollowup()}>Draft follow-up</button>
            {draft && <div><label>Subject<input value={draft.subject} readOnly /></label><label>Body<textarea rows={8} value={draft.body} readOnly /></label></div>}
          </div>
        </section>
      )}
    </main>
  );
}
