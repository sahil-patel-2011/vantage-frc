"use client";
import { useCallback, useEffect, useState } from "react";
import { CAN_BUSES, DEVICE_TYPES, deviceTypeLabel, deviceUsesCan, type CanBus, type WiringConflict } from "../../lib/wiring";

type Device = {
  id: string; name: string; deviceType: string; canId: number | null; canBus: CanBus;
  pdhPort: number | null; breakerAmp: number | null; subsystem: string; notes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; devices: Device[]; summary: { totalDevices: number; canDevices: number; conflicts: WiringConflict[]; conflictCount: number } };

const EMPTY = { name: "", deviceType: "talonfx", canId: "", canBus: "rio", pdhPort: "", breakerAmp: "", subsystem: "", notes: "" };

function conflictText(c: WiringConflict): string {
  if (c.kind === "can_id") return `Duplicate CAN ID ${c.canId} on ${c.canBus} (${deviceTypeLabel(c.deviceType)}): ${c.deviceNames.join(", ")}`;
  return `Two devices on power port ${c.port}: ${c.deviceNames.join(", ")}`;
}

export default function WiringClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/wiring?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load wiring map"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/wiring", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addDevice(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_device", seasonYear, ...form }, "Device added.");
    if (view?.status === "ready") setForm({ ...EMPTY, deviceType: form.deviceType, canBus: form.canBus, subsystem: form.subsystem });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading wiring map…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / WIRING</span><h1>Wiring map</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const canForm = deviceUsesCan(form.deviceType);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / WIRING</span><h1>Wiring &amp; CAN-bus map — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/inventory${orgId ? `?orgId=${orgId}` : ""}`}>Inventory</a><a href={`/batteries${orgId ? `?orgId=${orgId}` : ""}`}>Batteries</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Devices mapped</span><strong>{view.summary.totalDevices}</strong></article>
        <article><span>On the CAN bus</span><strong>{view.summary.canDevices}</strong></article>
        <article><span>Conflicts</span><strong>{view.summary.conflictCount}</strong></article>
      </section>

      {view.summary.conflicts.length > 0 && (
        <section className="intel-panel" style={{ borderColor: "#b91c1c" }}>
          <span className="eyebrow">⚠ WIRING CONFLICTS — FIX BEFORE POWERING ON</span>
          {view.summary.conflicts.map((c, i) => (
            <article key={i}><div><strong>{conflictText(c)}</strong></div></article>
          ))}
        </section>
      )}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addDevice}>
          <span className="eyebrow">ADD A DEVICE</span>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Front Left Drive" /></label>
          <label>Type<select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value })}>{DEVICE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></label>
          {canForm && (
            <div className="budget-fields">
              <label>CAN ID<input type="number" min="0" max="62" value={form.canId} onChange={(e) => setForm({ ...form, canId: e.target.value })} /></label>
              <label>CAN bus<select value={form.canBus} onChange={(e) => setForm({ ...form, canBus: e.target.value })}>{CAN_BUSES.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
            </div>
          )}
          <div className="budget-fields">
            <label>Power port<input type="number" min="0" max="23" value={form.pdhPort} onChange={(e) => setForm({ ...form, pdhPort: e.target.value })} /></label>
            <label>Breaker (A)<input type="number" min="0" max="60" value={form.breakerAmp} onChange={(e) => setForm({ ...form, breakerAmp: e.target.value })} /></label>
          </div>
          <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Drivetrain" /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Add device</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">CAN ID MAP</span>
          <p><small>Quick reference — each same-type device needs a unique CAN ID per bus.</small></p>
          {view.devices.filter((d) => d.canId != null).length === 0 && <p>No CAN devices yet.</p>}
          {view.devices.filter((d) => d.canId != null).map((d) => (
            <article key={d.id}><div><strong>[{d.canBus} · {d.canId}] {d.name}</strong><small>{deviceTypeLabel(d.deviceType)}{d.subsystem ? ` · ${d.subsystem}` : ""}</small></div></article>
          ))}
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">ALL DEVICES</span>
        {view.devices.length === 0 && <p>No devices mapped yet — add your motor controllers, sensors, and power devices.</p>}
        {view.devices.map((d) => (
          <article key={d.id}>
            <div style={{ flex: 1 }}>
              <strong>{d.name} · {deviceTypeLabel(d.deviceType)}</strong>
              <small>
                {d.canId != null ? `CAN ${d.canBus}:${d.canId}` : "no CAN"}
                {d.pdhPort != null ? ` · port ${d.pdhPort}` : ""}
                {d.breakerAmp != null ? ` · ${d.breakerAmp}A` : ""}
                {d.subsystem ? ` · ${d.subsystem}` : ""}
                {d.notes ? ` · ${d.notes}` : ""}
              </small>
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_device", id: d.id }, "Device removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
