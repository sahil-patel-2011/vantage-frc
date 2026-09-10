"use client";
import { useCallback, useEffect, useState } from "react";
import { MOTORS, SUBSYSTEM_CATEGORIES, computeFreeSpeedFps, motorFreeRpm, motorLabel, type SubsystemCategory } from "../../lib/subsystems";

import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Subsystem = {
  id: string; name: string; category: SubsystemCategory; motorType: string; motorCount: number | null;
  gearReduction: number | null; wheelDiameterIn: number | null; notes: string; byName: string | null; freeSpeedFps: number | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; subsystems: Subsystem[] };

const EMPTY = { name: "", category: "drivetrain", motorType: "neo", motorCount: "", gearReduction: "", wheelDiameterIn: "", notes: "" };

export default function SubsystemsClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/subsystems?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setErrorStatus(response.status); setMessage(data.error ?? "Failed to load subsystems"); return; }
    setErrorStatus(null);
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/subsystems", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addSubsystem(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_subsystem", seasonYear, ...form }, "Subsystem saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  if (!view) {
    if (!message) return <main className="intel-app"><p className="telemetry-status">Loading subsystems…</p></main>;
    const copy = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status"><strong>{copy.title}</strong> — {copy.description}</p>
        {copy.primary ? <a className="app-button" href={copy.primary.href}>{copy.primary.label}</a> : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / SUBSYSTEMS</span><h1>Subsystem specs</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  // Live preview of the free-speed calc for the form as it's filled in.
  const previewFps = computeFreeSpeedFps(motorFreeRpm(form.motorType), Number(form.gearReduction) || null, Number(form.wheelDiameterIn) || null);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / SUBSYSTEMS</span><h1>Subsystem spec sheet — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/wiring${orgId ? `?orgId=${orgId}` : ""}`}>Wiring</a><a href={`/cad${orgId ? `?orgId=${orgId}` : ""}`}>CAD</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addSubsystem}>
          <span className="eyebrow">ADD A SUBSYSTEM</span>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Swerve drivetrain" /></label>
          <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{SUBSYSTEM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <div className="budget-fields">
            <label>Motor<select value={form.motorType} onChange={(e) => setForm({ ...form, motorType: e.target.value })}><option value="">—</option>{MOTORS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
            <label>Motor count<input type="number" min="0" value={form.motorCount} onChange={(e) => setForm({ ...form, motorCount: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label>Gear reduction (X:1)<input type="number" min="0" step="0.001" value={form.gearReduction} onChange={(e) => setForm({ ...form, gearReduction: e.target.value })} placeholder="6.75" /></label>
            <label>Wheel dia. (in)<input type="number" min="0" step="0.1" value={form.wheelDiameterIn} onChange={(e) => setForm({ ...form, wheelDiameterIn: e.target.value })} placeholder="4" /></label>
          </div>
          {previewFps != null && <p className="telemetry-status success">Theoretical free speed: {previewFps} ft/s</p>}
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save subsystem</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">FREE-SPEED CALCULATOR</span>
          <p>Pick a motor, gear reduction, and wheel diameter and this computes theoretical free speed (ft/s) — the number you check on every drivetrain design iteration. Actual speed runs ~10-20% lower under load.</p>
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">SUBSYSTEMS</span>
        {view.subsystems.length === 0 && <p>No subsystems yet — start with your drivetrain.</p>}
        {view.subsystems.map((s) => (
          <article key={s.id}>
            <div style={{ flex: 1 }}>
              <strong>{s.name} · {s.category}{s.freeSpeedFps != null ? ` · ${s.freeSpeedFps} ft/s` : ""}</strong>
              <small>
                {s.motorCount != null && s.motorType ? `${s.motorCount}× ${motorLabel(s.motorType)}` : s.motorType ? motorLabel(s.motorType) : "no motor set"}
                {s.gearReduction != null ? ` · ${s.gearReduction}:1` : ""}
                {s.wheelDiameterIn != null ? ` · ${s.wheelDiameterIn}in wheel` : ""}
                {s.notes ? ` · ${s.notes}` : ""}
              </small>
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_subsystem", id: s.id }, "Subsystem removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
