"use client";
import { useCallback, useEffect, useState } from "react";
import { FUNDRAISER_TYPE_LABEL, FUNDRAISER_TYPES, attainmentPct, type FundraiserStatus, type FundraiserType } from "../../lib/fundraisers";

type FundraiserEvent = {
  id: string; seasonYear: number; name: string; type: FundraiserType; eventDate: string;
  goalUsd: number | null; proceedsUsd: number; status: FundraiserStatus; location: string; notes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; events: FundraiserEvent[]; summary: { totalRaised: number; totalGoal: number; attainment: number | null; planned: number; active: number; completed: number } };

const STATUS_FLOW: Record<FundraiserStatus, FundraiserStatus | null> = { planned: "active", active: "completed", completed: null, cancelled: null };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function FundraisersClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", type: "car_wash", eventDate: todayIso(), goalUsd: "", location: "", notes: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/fundraisers?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load fundraisers"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/fundraisers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addEvent(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_event", seasonYear, ...form }, "Fundraiser added.");
    if (view?.status === "ready") setForm({ name: "", type: "car_wash", eventDate: todayIso(), goalUsd: "", location: "", notes: "" });
  }

  async function recordProceeds(id: string) {
    const amount = window.prompt("How much did you collect (deposit amount, $)?");
    if (!amount) return;
    await post({ action: "record_proceeds", id, amountUsd: Number(amount) }, "Proceeds recorded and posted to finance.");
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading fundraisers…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / FUNDRAISERS</span><h1>Fundraisers</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const canManageMoney = view.context.role === "owner" || view.context.role === "admin";

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / FUNDRAISERS</span><h1>Fundraiser events — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/team/finance${orgId ? `?orgId=${orgId}` : ""}`}>Finance</a><a href={`/team/sponsors${orgId ? `?orgId=${orgId}` : ""}`}>Sponsors</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Raised this season</span><strong>${view.summary.totalRaised.toLocaleString()}</strong></article>
        <article><span>Combined goal</span><strong>{view.summary.totalGoal ? `$${view.summary.totalGoal.toLocaleString()}` : "—"}</strong></article>
        <article><span>Attainment</span><strong>{view.summary.attainment != null ? `${view.summary.attainment}%` : "—"}</strong></article>
        <article><span>Planned / active / done</span><strong>{view.summary.planned} / {view.summary.active} / {view.summary.completed}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addEvent}>
          <span className="eyebrow">PLAN A FUNDRAISER</span>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Spring car wash" /></label>
          <div className="budget-fields">
            <label>Type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{FUNDRAISER_TYPES.map((t) => <option key={t} value={t}>{FUNDRAISER_TYPE_LABEL[t]}</option>)}</select></label>
            <label>Date<input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label>Goal ($)<input type="number" min="0" step="0.01" value={form.goalUsd} onChange={(e) => setForm({ ...form, goalUsd: e.target.value })} /></label>
            <label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Add fundraiser</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">HOW IT CONNECTS</span>
          <p>Recorded proceeds post straight to your <a href={`/team/finance${orgId ? `?orgId=${orgId}` : ""}`}>team finance</a> ledger as income (source: fundraiser), so your season fundraising total stays accurate automatically.</p>
          <p>{canManageMoney ? "You can record proceeds." : "Ask an owner/admin to record proceeds — money entries are admin-only."}</p>
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">FUNDRAISERS</span>
        {view.events.length === 0 && <p>No fundraisers planned yet.</p>}
        {view.events.map((e) => {
          const pct = attainmentPct(e.proceedsUsd, e.goalUsd);
          return (
            <article key={e.id}>
              <div style={{ flex: 1 }}>
                <strong>{e.name} · {FUNDRAISER_TYPE_LABEL[e.type]}</strong>
                <small>
                  {new Date(e.eventDate).toLocaleDateString()} · {e.status}
                  {e.location ? ` · ${e.location}` : ""} · raised ${e.proceedsUsd.toLocaleString()}
                  {e.goalUsd ? ` of $${e.goalUsd.toLocaleString()}${pct != null ? ` (${pct}%)` : ""}` : ""}
                </small>
              </div>
              <div>
                {STATUS_FLOW[e.status] && <button onClick={() => void post({ action: "set_status", id: e.id, status: STATUS_FLOW[e.status] }, "Status updated.")}>Mark {STATUS_FLOW[e.status]}</button>}
                {canManageMoney && e.status !== "cancelled" && <button onClick={() => void recordProceeds(e.id)}>Record $</button>}
                {e.status !== "completed" && e.status !== "cancelled" && <button onClick={() => void post({ action: "set_status", id: e.id, status: "cancelled" }, "Cancelled.")}>Cancel</button>}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
