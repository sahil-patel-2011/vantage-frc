"use client";
import { Button, EmptyState } from "../../components/ui";
import { useCallback, useEffect, useState } from "react";
import { AUTO_PRIORITIES, AUTO_STATUS_LABEL, AUTO_STATUSES, START_POSITIONS, type AutoPriority, type AutoStatus, type StartPosition } from "../../lib/auto-routines";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Routine = {
  id: string; name: string; startPosition: StartPosition; status: AutoStatus; priority: AutoPriority;
  estimatedPoints: number | null; description: string; pathNotes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; routines: Routine[]; summary: { total: number; ready: number; proven: number; coveredStartPositions: string[]; highPriorityUnproven: number; bestReadyPoints: number | null } };

const EMPTY = { name: "", startPosition: "center", status: "concept", priority: "normal", estimatedPoints: "", description: "", pathNotes: "" };

export default function AutoRoutinesClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState<{ status: number | null; message: string } | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/auto-routines?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) {
      setLoadError({ status: response.status, message: data.error ?? "Failed to load auto library" });
      return;
    }
    setLoadError(null);
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/auto-routines", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addRoutine(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_routine", seasonYear, ...form }, "Routine added.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  if (!view) {
    if (!loadError) return <main className="intel-app"><p className="telemetry-status">{message || "Loading auto library…"}</p></main>;
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: loadError.status,
        message: loadError.message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message: loadError.message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status" role="alert">
          <strong>{copy.title}</strong>
          <br />
          {copy.description}
        </p>
        <nav className="intel-actions">
          {copy.primary ? <Button as="a" variant="primary" href={copy.primary.href}>{copy.primary.label}</Button> : null}
          {copy.showRetry ? <Button variant="secondary" type="button" onClick={() => void load()}>Retry</Button> : null}
        </nav>
      </main>
    );
  }
  if (view.status === "setup_required") {
    return (
      <main className="intel-app">
        <header className="intel-header">
          <div>
            <span className="eyebrow">VANTAGE / AUTOS</span>
            <h1>Autonomous library</h1>
          </div>
        </header>
        <EmptyState badge="Setup required" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / AUTOS</span><h1>Autonomous routine library — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/strategy${orgId ? `?orgId=${orgId}` : ""}`}>Strategy</a><a href={`/code${orgId ? `?orgId=${orgId}` : ""}`}>Code</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Competition-ready</span><strong>{view.summary.ready}</strong></article>
        <article><span>Start positions covered</span><strong>{view.summary.coveredStartPositions.length}/3</strong></article>
        <article><span>High-priority unproven</span><strong>{view.summary.highPriorityUnproven}</strong></article>
        <article><span>Best ready auto</span><strong>{view.summary.bestReadyPoints != null ? `${view.summary.bestReadyPoints} pts` : "—"}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addRoutine}>
          <span className="eyebrow">ADD AN AUTO ROUTINE</span>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Center 3-piece" /></label>
          <div className="budget-fields">
            <label>Start position<select value={form.startPosition} onChange={(e) => setForm({ ...form, startPosition: e.target.value })}>{START_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
            <label>Est. points<input type="number" min="0" value={form.estimatedPoints} onChange={(e) => setForm({ ...form, estimatedPoints: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{AUTO_STATUSES.map((s) => <option key={s} value={s}>{AUTO_STATUS_LABEL[s]}</option>)}</select></label>
            <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{AUTO_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          </div>
          <label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>Path / sequence notes<input value={form.pathNotes} onChange={(e) => setForm({ ...form, pathNotes: e.target.value })} /></label>
          <button className="primary-action">Add routine</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">READINESS</span>
          <p>{view.summary.ready} of {view.summary.total} routines are competition-ready.</p>
          <p><small>Start positions with a ready auto: {view.summary.coveredStartPositions.length ? view.summary.coveredStartPositions.join(", ") : "none yet"}.</small></p>
          {view.summary.highPriorityUnproven > 0 && <p><b>{view.summary.highPriorityUnproven} high-priority auto(s) still need testing.</b></p>}
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">ROUTINES</span>
        {view.routines.length === 0 && <p>No auto routines yet.</p>}
        {view.routines.map((r) => (
          <article key={r.id}>
            <div style={{ flex: 1 }}>
              <strong>{r.name}{r.status === "competition_ready" ? " ✓" : ""}</strong>
              <small>from {r.startPosition} · {AUTO_STATUS_LABEL[r.status]} · {r.priority} priority{r.estimatedPoints != null ? ` · ~${r.estimatedPoints} pts` : ""}{r.description ? ` · ${r.description}` : ""}</small>
              {r.pathNotes && <small>{r.pathNotes}</small>}
            </div>
            <div>
              {r.status !== "competition_ready" && r.status !== "retired" && <button onClick={() => void post({ action: "set_status", id: r.id, status: "competition_ready" }, "Marked ready.")}>Mark ready</button>}
              {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_routine", id: r.id }, "Routine deleted.")}>Delete</button>}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
