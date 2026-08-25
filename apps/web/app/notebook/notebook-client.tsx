"use client";
import { useCallback, useEffect, useState } from "react";
import { BUILD_PHASE_LABEL, BUILD_PHASES, type BuildPhase } from "../../lib/notebook";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Entry = {
  id: string; seasonYear: number; entryDate: string; phase: BuildPhase; subsystem: string;
  title: string; body: string; tags: string[]; byName: string | null; updatedAt: string;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; entries: Entry[]; summary: { total: number; subsystems: { name: string; count: number }[]; phases: { phase: BuildPhase; count: number }[]; lastEntryOn: string | null } };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function NotebookClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead-end error line.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [subsystemFilter, setSubsystemFilter] = useState("");
  const [form, setForm] = useState({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "" });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (orgId) params.set("orgId", orgId);
    if (subsystemFilter) params.set("subsystem", subsystemFilter);
    const response = await fetch(`/api/notebook${params.toString() ? `?${params}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load notebook"); setErrorStatus(response.status); return; }
    setErrorStatus(null);
    setView(data);
  }, [orgId, subsystemFilter]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/notebook", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_entry", seasonYear, ...form }, "Entry added.");
    if (view?.status === "ready") setForm({ title: "", entryDate: todayIso(), phase: "design", subsystem: "", tags: "", body: "" });
  }

  if (!view) {
    if (!message) return <main className="intel-app"><p className="telemetry-status">Loading notebook…</p></main>;
    // The notebook never loaded: say why, and offer the action that actually fixes it.
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined"
            ? null
            : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status"><strong>{copy.title}</strong></p>
        <p className="telemetry-status">{copy.description}</p>
        {copy.primary ? <a className="app-button" href={copy.primary.href}>{copy.primary.label}</a> : null}
        {copy.showRetry ? <button type="button" className="primary-action" onClick={() => void load()}>Retry</button> : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / NOTEBOOK</span><h1>Engineering notebook</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / NOTEBOOK</span><h1>Engineering &amp; build notebook</h1></div>
        <nav className="intel-actions"><a href={`/impact${orgId ? `?orgId=${orgId}` : ""}`}>Impact</a><a href={`/team/awards${orgId ? `?orgId=${orgId}` : ""}`}>Awards</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Entries</span><strong>{view.summary.total}</strong></article>
        <article><span>Subsystems documented</span><strong>{view.summary.subsystems.length}</strong></article>
        <article><span>Last entry</span><strong>{view.summary.lastEntryOn ? new Date(view.summary.lastEntryOn).toLocaleDateString() : "—"}</strong></article>
        <article><span>Season</span><strong>{seasonYear}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addEntry}>
          <span className="eyebrow">NEW NOTEBOOK ENTRY</span>
          <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Intake roller prototype #2" /></label>
          <div className="budget-fields">
            <label>Date<input type="date" value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} /></label>
            <label>Phase<select value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value })}>{BUILD_PHASES.map((p) => <option key={p} value={p}>{BUILD_PHASE_LABEL[p]}</option>)}</select></label>
          </div>
          <div className="budget-fields">
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Intake" /></label>
            <label>Tags (comma-separated)<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="cad, test" /></label>
          </div>
          <label>What did you decide / learn?<textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
          <button className="primary-action">Add entry</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">SUBSYSTEMS</span>
          <p><a href="#" onClick={(e) => { e.preventDefault(); setSubsystemFilter(""); }}>{subsystemFilter ? "Show all" : "All subsystems"}</a></p>
          {view.summary.subsystems.map((s) => (
            <article key={s.name} onClick={() => setSubsystemFilter(s.name === "General" ? "" : s.name)} style={{ cursor: "pointer" }}>
              <div><strong>{s.name}</strong><small>{s.count} {s.count === 1 ? "entry" : "entries"}</small></div>
            </article>
          ))}
          {view.summary.phases.length > 0 && (
            <p><small>{view.summary.phases.map((p) => `${BUILD_PHASE_LABEL[p.phase]}: ${p.count}`).join(" · ")}</small></p>
          )}
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">{subsystemFilter ? `${subsystemFilter.toUpperCase()} ENTRIES` : "ALL ENTRIES"}</span>
        {view.entries.length === 0 && <p>No entries yet — document your first design decision above.</p>}
        {view.entries.map((entry) => (
          <article key={entry.id}>
            <div style={{ flex: 1 }}>
              <strong>{entry.title}</strong>
              <small>{new Date(entry.entryDate).toLocaleDateString()} · {BUILD_PHASE_LABEL[entry.phase]}{entry.subsystem ? ` · ${entry.subsystem}` : ""}{entry.byName ? ` · ${entry.byName}` : ""}{entry.tags.length ? ` · ${entry.tags.map((t) => `#${t}`).join(" ")}` : ""}</small>
              {entry.body && <small style={{ whiteSpace: "pre-wrap" }}>{entry.body}</small>}
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_entry", id: entry.id }, "Entry deleted.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
