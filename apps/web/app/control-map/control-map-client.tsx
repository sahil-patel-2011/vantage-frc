"use client";
import { useCallback, useEffect, useState } from "react";
import { CONTROLLERS, CONTROLLER_LABEL, CONTROL_MODES, COMMON_INPUTS, type ControlMode, type Controller } from "../../lib/control-map";

type Binding = { id: string; controller: Controller; inputLabel: string; command: string; mode: ControlMode; notes: string; byName: string | null };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; bindings: Binding[]; summary: { total: number; byController: Record<Controller, number> } };

const EMPTY = { controller: "driver", inputLabel: "", command: "", mode: "teleop", notes: "" };

export default function ControlMapClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/control-map?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load control map"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/control-map", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addBinding(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_binding", seasonYear, ...form }, "Binding saved.");
    if (view?.status === "ready") setForm({ ...EMPTY, controller: form.controller });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading control map…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / CONTROLS</span><h1>Control map</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / CONTROLS</span><h1>Driver control map — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/practice${orgId ? `?orgId=${orgId}` : ""}`}>Practice</a><a href={`/auto-routines${orgId ? `?orgId=${orgId}` : ""}`}>Autos</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Bindings</span><strong>{view.summary.total}</strong></article>
        <article><span>Driver</span><strong>{view.summary.byController.driver}</strong></article>
        <article><span>Operator</span><strong>{view.summary.byController.operator}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addBinding}>
          <span className="eyebrow">ADD A BINDING</span>
          <div className="budget-fields">
            <label>Controller<select value={form.controller} onChange={(e) => setForm({ ...form, controller: e.target.value })}>{CONTROLLERS.map((c) => <option key={c} value={c}>{CONTROLLER_LABEL[c]}</option>)}</select></label>
            <label>Mode<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>{CONTROL_MODES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          </div>
          <label>Input<input required list="common-inputs" value={form.inputLabel} onChange={(e) => setForm({ ...form, inputLabel: e.target.value })} placeholder="Right trigger" /></label>
          <datalist id="common-inputs">{COMMON_INPUTS.map((i) => <option key={i} value={i} />)}</datalist>
          <label>Action<input required value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="Shoot" /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save binding</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">DRIVE-TEAM CHEAT SHEET</span>
          <p>Keep this in sync with the robot code&apos;s button bindings. Print it for the driver station so the drive team always knows which input does what — no guessing on the field.</p>
        </section>
      </section>

      {CONTROLLERS.filter((c) => view.bindings.some((b) => b.controller === c)).map((controller) => (
        <section className="intel-panel invite-list" key={controller}>
          <span className="eyebrow">{CONTROLLER_LABEL[controller].toUpperCase()} CONTROLLER</span>
          {view.bindings.filter((b) => b.controller === controller).map((b) => (
            <article key={b.id}>
              <div style={{ flex: 1 }}>
                <strong>{b.inputLabel} → {b.command}</strong>
                <small>{b.mode}{b.notes ? ` · ${b.notes}` : ""}{b.byName ? ` · ${b.byName}` : ""}</small>
              </div>
              {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_binding", id: b.id }, "Binding removed.")}>Delete</button>}
            </article>
          ))}
        </section>
      ))}

      {view.bindings.length === 0 && <section className="intel-panel"><p>No bindings yet — map your drive and operator controls above.</p></section>}
    </main>
  );
}
