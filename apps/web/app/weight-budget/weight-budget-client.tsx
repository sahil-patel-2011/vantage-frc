"use client";
import { useCallback, useEffect, useState } from "react";
import { stale125WeightLimitCue } from "../../lib/weight-budget";

type Component = { id: string; name: string; subsystem: string; weightLbs: number; quantity: number; notes: string; byName: string | null };
type Summary = { count: number; totalLbs: number; limitLbs: number; remainingLbs: number; overLimit: boolean; percentUsed: number; bySubsystem: { subsystem: string; lbs: number }[] };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; components: Component[]; summary: Summary };

const EMPTY = { name: "", subsystem: "", weightLbs: "", quantity: "1", notes: "" };

export default function WeightBudgetClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [limitDraft, setLimitDraft] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/weight-budget?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load weight budget"); return; }
    setView(data);
    if (data.status === "ready") setLimitDraft(String(data.summary.limitLbs));
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/weight-budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addComponent(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_component", seasonYear, ...form }, "Component added.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading weight budget…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / WEIGHT</span><h1>Weight budget</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const s = view.summary;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / WEIGHT</span><h1>Weight budget — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/subsystems${orgId ? `?orgId=${orgId}` : ""}`}>Subsystems</a><a href={`/inspection${orgId ? `?orgId=${orgId}` : ""}`}>Inspection</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      {stale125WeightLimitCue(s.limitLbs) ? (
        <p className="telemetry-status" role="status">{stale125WeightLimitCue(s.limitLbs)}</p>
      ) : null}

      <section className="metric-grid">
        <article><span>Total weight</span><strong>{s.totalLbs} lb</strong></article>
        <article><span>Limit</span><strong>{s.limitLbs} lb</strong></article>
        <article><span>Remaining</span><strong>{s.remainingLbs} lb</strong></article>
        <article><span>Used</span><strong>{s.percentUsed}%</strong></article>
      </section>

      {s.overLimit && (
        <section className="intel-panel" style={{ borderColor: "#b91c1c" }}>
          <span className="eyebrow">⚠ OVER THE WEIGHT LIMIT</span>
          <article><div><strong>{s.totalLbs} lb exceeds the {s.limitLbs} lb limit by {Math.abs(s.remainingLbs)} lb. Cut weight before inspection.</strong></div></article>
        </section>
      )}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addComponent}>
          <span className="eyebrow">ADD A COMPONENT</span>
          <div className="budget-fields">
            <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Swerve module" /></label>
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Drivetrain" /></label>
          </div>
          <div className="budget-fields">
            <label>Weight each (lb)<input required type="number" min="0" step="0.01" value={form.weightLbs} onChange={(e) => setForm({ ...form, weightLbs: e.target.value })} /></label>
            <label>Quantity<input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Add component</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">BY SUBSYSTEM</span>
          {s.bySubsystem.length === 0 && <p>No components logged yet.</p>}
          {s.bySubsystem.map((b) => <article key={b.subsystem}><div><strong>{b.subsystem}</strong><small>{b.lbs} lb · {s.totalLbs > 0 ? Math.round((b.lbs / s.totalLbs) * 100) : 0}% of robot</small></div></article>)}
          <form onSubmit={(e) => { e.preventDefault(); void post({ action: "set_limit", seasonYear, limitLbs: limitDraft }, "Limit updated."); }}>
            <label>Weight limit (lb)<input type="number" min="0" step="0.1" value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} /></label>
            <button className="primary-action">Set limit</button>
          </form>
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">COMPONENTS</span>
        {view.components.length === 0 && <p>No components yet — log your heavy items first (drivetrain, battery mount, superstructure).</p>}
        {view.components.map((c) => (
          <article key={c.id}>
            <div style={{ flex: 1 }}>
              <strong>{c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""} · {(c.weightLbs * c.quantity).toFixed(2)} lb</strong>
              <small>{c.weightLbs} lb each{c.subsystem ? ` · ${c.subsystem}` : ""}{c.notes ? ` · ${c.notes}` : ""}</small>
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_component", id: c.id }, "Component removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
