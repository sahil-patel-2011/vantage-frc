"use client";
import { useCallback, useEffect, useState } from "react";
import { BRINGUP_PHASES, BRINGUP_PHASE_LABEL, BRINGUP_RESULTS, type BringupPhase, type BringupResult } from "../../lib/bringup";

type Item = { id: string; phase: BringupPhase; label: string; result: BringupResult; note: string; sortOrder: number };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; items: Item[]; progress: { total: number; done: number; failed: number; percent: number; ready: boolean } };

const RESULT_LABEL: Record<BringupResult, string> = { pending: "—", pass: "Pass", fail: "Fail", na: "N/A" };

export default function BringupClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [custom, setCustom] = useState({ phase: "mechanical", label: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/bringup?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load checklist"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/bringup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading bring-up checklist…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / BRING-UP</span><h1>Robot bring-up</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const p = view.progress;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / BRING-UP</span><h1>Robot bring-up checklist — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/inspection${orgId ? `?orgId=${orgId}` : ""}`}>Inspection</a><a href={`/wiring${orgId ? `?orgId=${orgId}` : ""}`}>Wiring</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Progress</span><strong>{p.percent}%</strong></article>
        <article><span>Done</span><strong>{p.done}/{p.total}</strong></article>
        <article><span>Failures</span><strong>{p.failed}</strong></article>
        <article><span>Ready to drive</span><strong>{p.ready ? "YES" : "no"}</strong></article>
      </section>

      {view.items.length === 0 && (
        <section className="intel-panel">
          <span className="eyebrow">GET STARTED</span>
          <p>Load the standard commissioning checklist (mechanical, electrical, software, validation) for this robot.</p>
          <button className="primary-action" onClick={() => void post({ action: "seed_template", seasonYear }, "Standard checklist loaded.")}>Load standard checklist</button>
        </section>
      )}

      {BRINGUP_PHASES.filter((ph) => view.items.some((i) => i.phase === ph)).map((phase) => (
        <section className="intel-panel invite-list" key={phase}>
          <span className="eyebrow">{BRINGUP_PHASE_LABEL[phase].toUpperCase()}</span>
          {view.items.filter((i) => i.phase === phase).map((item) => (
            <article key={item.id}>
              <div style={{ flex: 1 }}>
                <strong>{item.result === "pass" ? "✓ " : item.result === "fail" ? "✗ " : ""}{item.label}</strong>
                <small>{RESULT_LABEL[item.result]}{item.note ? ` · ${item.note}` : ""}</small>
              </div>
              <div>
                {BRINGUP_RESULTS.filter((r) => r !== "pending" && r !== item.result).map((r) => (
                  <button key={r} onClick={() => void post({ action: "set_result", id: item.id, result: r }, "Updated.")}>{RESULT_LABEL[r]}</button>
                ))}
                {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_item", id: item.id }, "Removed.")}>✕</button>}
              </div>
            </article>
          ))}
        </section>
      ))}

      {view.items.length > 0 && (
        <form className="intel-panel" onSubmit={(e) => { e.preventDefault(); if (custom.label.trim()) { void post({ action: "add_item", seasonYear, ...custom }, "Item added."); setCustom({ ...custom, label: "" }); } }}>
          <span className="eyebrow">ADD A CUSTOM ITEM</span>
          <div className="budget-fields">
            <label>Phase<select value={custom.phase} onChange={(e) => setCustom({ ...custom, phase: e.target.value })}>{BRINGUP_PHASES.map((ph) => <option key={ph} value={ph}>{BRINGUP_PHASE_LABEL[ph]}</option>)}</select></label>
            <label>Item<input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Check LED strip wiring" /></label>
          </div>
          <button className="primary-action">Add item</button>
        </form>
      )}
    </main>
  );
}
