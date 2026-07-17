"use client";
import { useCallback, useEffect, useState } from "react";
import { MATCH_RESULTS, type Alliance, type MatchResult } from "../../lib/match-debrief";

type Debrief = {
  id: string; seasonYear: number; eventKey: string; matchLabel: string; alliance: Alliance; result: MatchResult;
  pointsScored: number | null; cycleCount: number | null; drivetrainOk: boolean; mechanismsOk: boolean; autoOk: boolean;
  whatWorked: string; whatBroke: string; actionItems: string; byName: string | null; createdAt: string;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; debriefs: Debrief[]; summary: { total: number; wins: number; losses: number; ties: number; record: string; avgPoints: number | null; openActionItems: number } };

const RESULT_LABEL: Record<MatchResult, string> = { win: "Win", loss: "Loss", tie: "Tie", unknown: "—" };
const EMPTY = { matchLabel: "", eventKey: "", alliance: "unknown", result: "unknown", pointsScored: "", cycleCount: "", drivetrainOk: true, mechanismsOk: true, autoOk: true, whatWorked: "", whatBroke: "", actionItems: "" };

export default function MatchDebriefClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/match-debrief?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load match log"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/match-debrief", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addDebrief(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_debrief", seasonYear, ...form }, "Match debrief saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading match log…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / MATCH LOG</span><h1>Match debrief</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const flag = (ok: boolean, label: string) => (ok ? "" : ` · ${label} issue`);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / MATCH LOG</span><h1>Our match debrief — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/scouting${orgId ? `?orgId=${orgId}` : ""}`}>Scouting</a><a href={`/repairs${orgId ? `?orgId=${orgId}` : ""}`}>Repairs</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      <p className="telemetry-status">Log how <strong>our</strong> robot performed each match — separate from scouting other teams. Patterns here tell you what to fix before the next match.</p>

      <section className="metric-grid">
        <article><span>Record (W-L-T)</span><strong>{view.summary.record}</strong></article>
        <article><span>Matches logged</span><strong>{view.summary.total}</strong></article>
        <article><span>Avg points</span><strong>{view.summary.avgPoints ?? "—"}</strong></article>
        <article><span>Matches with action items</span><strong>{view.summary.openActionItems}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addDebrief}>
          <span className="eyebrow">LOG A MATCH</span>
          <div className="budget-fields">
            <label>Match<input required value={form.matchLabel} onChange={(e) => setForm({ ...form, matchLabel: e.target.value })} placeholder="Qual 12" /></label>
            <label>Result<select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as MatchResult })}>{MATCH_RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}</select></label>
          </div>
          <div className="budget-fields">
            <label>Points scored<input type="number" min="0" value={form.pointsScored} onChange={(e) => setForm({ ...form, pointsScored: e.target.value })} /></label>
            <label>Cycles<input type="number" min="0" value={form.cycleCount} onChange={(e) => setForm({ ...form, cycleCount: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label className="check-field"><input type="checkbox" checked={form.drivetrainOk} onChange={(e) => setForm({ ...form, drivetrainOk: e.target.checked })} /> Drivetrain OK</label>
            <label className="check-field"><input type="checkbox" checked={form.mechanismsOk} onChange={(e) => setForm({ ...form, mechanismsOk: e.target.checked })} /> Mechanisms OK</label>
            <label className="check-field"><input type="checkbox" checked={form.autoOk} onChange={(e) => setForm({ ...form, autoOk: e.target.checked })} /> Auto OK</label>
          </div>
          <label>What worked<input value={form.whatWorked} onChange={(e) => setForm({ ...form, whatWorked: e.target.value })} /></label>
          <label>What broke<input value={form.whatBroke} onChange={(e) => setForm({ ...form, whatBroke: e.target.value })} /></label>
          <label>Action items before next match<input value={form.actionItems} onChange={(e) => setForm({ ...form, actionItems: e.target.value })} /></label>
          <button className="primary-action">Save debrief</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">OPEN ACTION ITEMS</span>
          {view.debriefs.filter((d) => d.actionItems.trim()).length === 0 && <p>No outstanding action items.</p>}
          {view.debriefs.filter((d) => d.actionItems.trim()).map((d) => (
            <article key={d.id}><div><strong>{d.matchLabel}</strong><small>{d.actionItems}</small></div></article>
          ))}
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">MATCH LOG</span>
        {view.debriefs.length === 0 && <p>No matches logged yet.</p>}
        {view.debriefs.map((d) => (
          <article key={d.id}>
            <div style={{ flex: 1 }}>
              <strong>{d.matchLabel} · {RESULT_LABEL[d.result]}{d.pointsScored != null ? ` · ${d.pointsScored} pts` : ""}</strong>
              <small>
                {d.cycleCount != null ? `${d.cycleCount} cycles` : "cycles n/a"}
                {flag(d.drivetrainOk, "drivetrain")}{flag(d.mechanismsOk, "mechanism")}{flag(d.autoOk, "auto")}
                {d.byName ? ` · ${d.byName}` : ""}
              </small>
              {d.whatWorked && <small>✓ {d.whatWorked}</small>}
              {d.whatBroke && <small>✗ {d.whatBroke}</small>}
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_debrief", id: d.id }, "Debrief deleted.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
