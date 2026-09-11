"use client";
import { Button, EmptyState } from "../../components/ui";
import { useCallback, useEffect, useState } from "react";
import { CAN_BUSES, DEVICE_TYPES, deviceTypeLabel, deviceUsesCan, type CanBus, type WiringConflict } from "../../lib/wiring";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Device = {
  id: string; name: string; deviceType: string; canId: number | null; canBus: CanBus;
  pdhPort: number | null; breakerAmp: number | null; subsystem: string; notes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; devices: Device[]; summary: { totalDevices: number; canDevices: number; conflicts: WiringConflict[]; conflictCount: number; pcmPhCanCues?: string[]; servoHubCues?: string[]; servoPowerCues?: string[] } };

const EMPTY = { name: "", deviceType: "talonfx", canId: "", canBus: "rio", pdhPort: "", breakerAmp: "", subsystem: "", notes: "" };

function conflictText(c: WiringConflict): string {
  if (c.kind === "can_id") return `Duplicate CAN ID ${c.canId} on ${c.canBus} (${deviceTypeLabel(c.deviceType)}): ${c.deviceNames.join(", ")}`;
  return `Two devices on power port ${c.port}: ${c.deviceNames.join(", ")}`;
}

export default function WiringClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/wiring?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load wiring map"); setErrorStatus(response.status); setLoadFailed(true); return; }
    setErrorStatus(null);
    setLoadFailed(false);
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

  if (!view) {
    if (!loadFailed) return <main className="intel-app"><p className="telemetry-status">Loading wiring map…</p></main>;
    // Retry cannot revive an expired session — offer the action that actually fixes it.
    const failure = loadFailureCopy(
      classifyLoadFailure({
        status: errorStatus,
        message,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      }),
      {
        nextPath:
          typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
        message,
      },
    );
    return (
      <main className="intel-app">
        <p className="telemetry-status" role="alert"><strong>{failure.title}</strong></p>
        <p className="telemetry-status">{failure.description}</p>
        {failure.primary ? <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button> : null}
        {failure.showRetry ? <Button variant="secondary" type="button" onClick={() => void load()}>Retry</Button> : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return (
      <main className="intel-app">
        <header className="intel-header">
          <div>
            <span className="eyebrow">VANTAGE / WIRING</span>
            <h1>Wiring map</h1>
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

  const canForm = deviceUsesCan(form.deviceType);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / WIRING</span><h1>Wiring &amp; CAN-bus map — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/inventory${orgId ? `?orgId=${orgId}` : ""}`}>Inventory</a><a href={`/batteries${orgId ? `?orgId=${orgId}` : ""}`}>Batteries</a><a href="/workspace">Your team →</a></nav>
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

      {(view.summary.pcmPhCanCues ?? []).length > 0 && (
        <section className="intel-panel" style={{ borderColor: "#b45309" }}>
          <span className="eyebrow">PCM / PH CAN</span>
          {(view.summary.pcmPhCanCues ?? []).map((cue) => (
            <article key={cue}><div><strong>{cue}</strong></div></article>
          ))}
        </section>
      )}

      {(view.summary.servoHubCues ?? []).length > 0 && (
        <section className="intel-panel" style={{ borderColor: "#b45309" }}>
          <span className="eyebrow">SERVO HUB</span>
          {(view.summary.servoHubCues ?? []).map((cue) => (
            <article key={cue}><div><strong>{cue}</strong></div></article>
          ))}
        </section>
      )}

      {(view.summary.servoPowerCues ?? []).length > 0 && (
        <section className="intel-panel" style={{ borderColor: "#b45309" }}>
          <span className="eyebrow">SERVO POWER (R506)</span>
          {(view.summary.servoPowerCues ?? []).map((cue) => (
            <article key={cue}><div><strong>{cue}</strong></div></article>
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
