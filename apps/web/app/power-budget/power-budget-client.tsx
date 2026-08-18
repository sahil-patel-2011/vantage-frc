"use client";
import { useCallback, useEffect, useState } from "react";

type Load = {
  id: string; name: string; subsystem: string; motorCount: number | null;
  typicalAmps: number | null; peakAmps: number | null; breakerAmps: number | null; notes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; loads: Load[]; summary: { count: number; totalTypicalAmps: number; totalPeakAmps: number; tripRisks: string[]; brownoutRisk: boolean; sustainedCeiling: number; breakerSizeCues: string[]; currentLimitCue: string | null } };

const EMPTY = { name: "", subsystem: "", motorCount: "", typicalAmps: "", peakAmps: "", breakerAmps: "", notes: "" };

export default function PowerBudgetClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/power-budget?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load power budget"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/power-budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addLoad(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_load", seasonYear, ...form }, "Load added.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading power budget…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / POWER</span><h1>Power budget</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const s = view.summary;
  const breakerCues = s.breakerSizeCues ?? [];
  const trip = new Set(s.tripRisks);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / POWER</span><h1>Power &amp; current budget — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/wiring${orgId ? `?orgId=${orgId}` : ""}`}>Wiring</a><a href={`/batteries${orgId ? `?orgId=${orgId}` : ""}`}>Batteries</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Loads</span><strong>{s.count}</strong></article>
        <article><span>Total typical draw</span><strong>{s.totalTypicalAmps} A</strong></article>
        <article><span>Total peak draw</span><strong>{s.totalPeakAmps} A</strong></article>
        <article><span>Brownout risk</span><strong>{s.brownoutRisk ? "YES" : "no"}</strong></article>
      </section>

      {(s.brownoutRisk || s.tripRisks.length > 0 || breakerCues.length > 0 || Boolean(s.currentLimitCue)) && (
        <section className="intel-panel" style={{ borderColor: "#b91c1c" }}>
          <span className="eyebrow">⚠ POWER WARNINGS</span>
          {s.brownoutRisk && <article><div><strong>Brownout risk: {s.totalTypicalAmps} A typical draw exceeds the {s.sustainedCeiling} A sustained ceiling. Expect voltage sag under load.</strong></div></article>}
          {s.currentLimitCue ? <article><div><strong>{s.currentLimitCue}</strong></div></article> : null}
          {s.tripRisks.map((name) => <article key={name}><div><strong>{name}: peak current exceeds its branch breaker — it will trip.</strong></div></article>)}
          {breakerCues.map((cue) => <article key={cue}><div><strong>{cue}</strong></div></article>)}
        </section>
      )}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addLoad}>
          <span className="eyebrow">ADD A LOAD</span>
          <div className="budget-fields">
            <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Drivetrain" /></label>
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label>Motors<input type="number" min="0" value={form.motorCount} onChange={(e) => setForm({ ...form, motorCount: e.target.value })} /></label>
            <label>Breaker (A)<input type="number" min="0" value={form.breakerAmps} onChange={(e) => setForm({ ...form, breakerAmps: e.target.value })} placeholder="40" /></label>
          </div>
          <div className="budget-fields">
            <label>Typical (A)<input type="number" min="0" step="0.1" value={form.typicalAmps} onChange={(e) => setForm({ ...form, typicalAmps: e.target.value })} placeholder="40" /></label>
            <label>Peak (A)<input type="number" min="0" step="0.1" value={form.peakAmps} onChange={(e) => setForm({ ...form, peakAmps: e.target.value })} placeholder="120" /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Add load</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">HOW TO READ IT</span>
          <p>Typical draw is your running average; keep it under ~{s.sustainedCeiling} A to avoid brownouts on a fresh battery. Peak is the worst-case per branch — if it tops the branch breaker, that breaker trips and you lose the mechanism mid-match.</p>
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">LOADS</span>
        {view.loads.length === 0 && <p>No loads yet — add your drivetrain and mechanisms.</p>}
        {view.loads.map((l) => (
          <article key={l.id}>
            <div style={{ flex: 1 }}>
              <strong>{l.name}{l.motorCount ? ` · ${l.motorCount} motors` : ""}{trip.has(l.name) ? " ⚠" : ""}</strong>
              <small>
                {l.typicalAmps != null ? `${l.typicalAmps}A typical` : "no typical"}
                {l.peakAmps != null ? ` · ${l.peakAmps}A peak` : ""}
                {l.breakerAmps != null ? ` · ${l.breakerAmps}A breaker` : ""}
                {l.subsystem ? ` · ${l.subsystem}` : ""}{l.notes ? ` · ${l.notes}` : ""}
              </small>
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_load", id: l.id }, "Load removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
