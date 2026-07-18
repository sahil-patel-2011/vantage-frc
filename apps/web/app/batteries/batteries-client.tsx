"use client";
import { useCallback, useEffect, useState } from "react";
import { BATTERY_LOG_KINDS, type BatteryStatus, type HealthStatus } from "../../lib/battery";

type Pack = {
  id: string; label: string; brand: string | null; nominalAh: number | null; purchaseDate: string | null;
  status: BatteryStatus; notes: string; cycleCount: number; ageMonths: number | null;
  lastInternalResistanceMohm: number | null; lastRestingVoltage: number | null; lastUsedAt: string | null; lastChargedAt: string | null;
  health: { status: HealthStatus; score: number; reasons: string[] };
};
type Log = {
  id: string; batteryId: string; batteryLabel: string; kind: string; restingVoltage: number | null;
  internalResistanceMohm: number | null; matchKey: string | null; note: string; byName: string | null; createdAt: string;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; packs: Pack[]; logs: Log[]; rotation: string[]; summary: { active: number; needAttention: number; retired: number } };

const HEALTH_LABEL: Record<HealthStatus, string> = { good: "Good", aging: "Aging", retire: "Retire" };
const LOG_KIND_LABEL: Record<string, string> = {
  charge: "Charged", storage_charge: "Storage charge", match: "Match", practice: "Practice",
  resistance_test: "Resistance test", note: "Note", retire: "Retired", return_to_service: "Back in service",
};

export default function BatteriesClient({ orgId }: { orgId: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [packForm, setPackForm] = useState({ label: "", brand: "", nominalAh: "18", purchaseDate: "", initialResistanceMohm: "", initialVoltage: "" });
  const [logForm, setLogForm] = useState({ batteryId: "", kind: "resistance_test", restingVoltage: "", internalResistanceMohm: "", matchKey: "", note: "" });

  const load = useCallback(async () => {
    const response = await fetch(`/api/batteries${orgId ? `?orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load batteries"); return; }
    setView(data);
    if (data.status === "ready" && !logForm.batteryId && data.packs[0]) {
      setLogForm((prev) => ({ ...prev, batteryId: data.packs[0]!.id }));
    }
  }, [orgId, logForm.batteryId]);
  useEffect(() => { void load(); }, [orgId]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/batteries", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addPack(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_pack", ...packForm }, "Battery added.");
    if (view?.status === "ready") setPackForm({ label: "", brand: "", nominalAh: "18", purchaseDate: "", initialResistanceMohm: "", initialVoltage: "" });
  }

  async function submitLog(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "log_event", ...logForm }, "Logged.");
    setLogForm((prev) => ({ ...prev, restingVoltage: "", internalResistanceMohm: "", matchKey: "", note: "" }));
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading batteries…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / BATTERIES</span><h1>Battery fleet</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const rotationPacks = view.rotation.map((id) => view.packs.find((p) => p.id === id)).filter((p): p is Pack => Boolean(p));

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / BATTERIES</span><h1>Battery fleet &amp; rotation</h1></div>
        <nav className="intel-actions"><a href={`/inventory${orgId ? `?orgId=${orgId}` : ""}`}>Inventory</a><a href={`/pit${orgId ? `?orgId=${orgId}` : ""}`}>Pit</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Active packs</span><strong>{view.summary.active}</strong></article>
        <article><span>Need attention</span><strong>{view.summary.needAttention}</strong></article>
        <article><span>Retired</span><strong>{view.summary.retired}</strong></article>
        <article><span>Next up</span><strong>{rotationPacks[0]?.label ?? "—"}</strong></article>
      </section>

      {rotationPacks.length > 0 && (
        <section className="intel-panel">
          <span className="eyebrow">RECOMMENDED ROTATION</span>
          <p>Healthiest packs, least-recently-used first — grab these for the next matches.</p>
          <div className="battery-rotation">
            {rotationPacks.map((p, index) => (
              <article key={p.id}><strong>{index + 1}. {p.label}</strong><small>health {p.health.score} · {p.cycleCount} cycles{p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : " · never used"}</small></article>
            ))}
          </div>
        </section>
      )}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addPack}>
          <span className="eyebrow">ADD A BATTERY</span>
          <label>Label<input required value={packForm.label} onChange={(e) => setPackForm({ ...packForm, label: e.target.value })} placeholder="B-01" /></label>
          <div className="budget-fields">
            <label>Brand<input value={packForm.brand} onChange={(e) => setPackForm({ ...packForm, brand: e.target.value })} placeholder="MK ES17-12" /></label>
            <label>Capacity (Ah)<input type="number" min="0" step="0.1" value={packForm.nominalAh} onChange={(e) => setPackForm({ ...packForm, nominalAh: e.target.value })} /></label>
          </div>
          <label>Purchase date<input type="date" value={packForm.purchaseDate} onChange={(e) => setPackForm({ ...packForm, purchaseDate: e.target.value })} /></label>
          <div className="budget-fields">
            <label>Initial resistance (mΩ)<input type="number" min="0" step="0.1" value={packForm.initialResistanceMohm} onChange={(e) => setPackForm({ ...packForm, initialResistanceMohm: e.target.value })} /></label>
            <label>Initial voltage (V)<input type="number" min="0" step="0.1" value={packForm.initialVoltage} onChange={(e) => setPackForm({ ...packForm, initialVoltage: e.target.value })} /></label>
          </div>
          <button className="primary-action">Add battery</button>
        </form>

        <form className="intel-panel" onSubmit={submitLog}>
          <span className="eyebrow">LOG AN EVENT</span>
          <label>Battery<select value={logForm.batteryId} onChange={(e) => setLogForm({ ...logForm, batteryId: e.target.value })}>{view.packs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label>Event<select value={logForm.kind} onChange={(e) => setLogForm({ ...logForm, kind: e.target.value })}>{BATTERY_LOG_KINDS.filter((k) => !["retire", "return_to_service"].includes(k)).map((k) => <option key={k} value={k}>{LOG_KIND_LABEL[k]}</option>)}</select></label>
          <div className="budget-fields">
            <label>Voltage (V)<input type="number" min="0" step="0.1" value={logForm.restingVoltage} onChange={(e) => setLogForm({ ...logForm, restingVoltage: e.target.value })} /></label>
            <label>Resistance (mΩ)<input type="number" min="0" step="0.1" value={logForm.internalResistanceMohm} onChange={(e) => setLogForm({ ...logForm, internalResistanceMohm: e.target.value })} /></label>
          </div>
          {(logForm.kind === "match" || logForm.kind === "practice") && <label>Match key<input value={logForm.matchKey} onChange={(e) => setLogForm({ ...logForm, matchKey: e.target.value })} placeholder="2026wimi_qm5" /></label>}
          <label>Note<input value={logForm.note} onChange={(e) => setLogForm({ ...logForm, note: e.target.value })} /></label>
          <button className="primary-action">Log event</button>
        </form>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">FLEET</span>
        {view.packs.length === 0 && <p>No batteries yet — add your first pack above.</p>}
        {view.packs.map((p) => (
          <article key={p.id}>
            <div>
              <strong>{p.label}{p.brand ? ` · ${p.brand}` : ""}</strong>
              <small>
                {HEALTH_LABEL[p.health.status]} (score {p.health.score}) · {p.status} · {p.cycleCount} cycles
                {p.lastInternalResistanceMohm != null ? ` · ${p.lastInternalResistanceMohm} mΩ` : ""}
                {p.lastRestingVoltage != null ? ` · ${p.lastRestingVoltage} V` : ""}
                {p.ageMonths != null ? ` · ${p.ageMonths} mo old` : ""}
              </small>
              {p.health.reasons.length > 0 && <small>{p.health.reasons.join("; ")}</small>}
            </div>
            <div>
              {p.status === "active" && <button onClick={() => void post({ action: "log_event", batteryId: p.id, kind: "charge" }, `${p.label} marked charged.`)}>Charged</button>}
              {p.status === "active"
                ? <button onClick={() => void post({ action: "set_status", id: p.id, status: "retired" }, `${p.label} retired.`)}>Retire</button>
                : <button onClick={() => void post({ action: "set_status", id: p.id, status: "active" }, `${p.label} back in service.`)}>Activate</button>}
              {p.health.status === "retire" && p.status === "active" && <b>RETIRE</b>}
            </div>
          </article>
        ))}
      </section>

      <section className="intel-panel">
        <span className="eyebrow">RECENT ACTIVITY</span>
        {view.logs.length === 0 && <p>No activity logged yet.</p>}
        {view.logs.slice(0, 30).map((log) => (
          <article key={log.id}>
            <div>
              <strong>{log.batteryLabel} · {LOG_KIND_LABEL[log.kind] ?? log.kind}</strong>
              <small>
                {new Date(log.createdAt).toLocaleString()}{log.byName ? ` · ${log.byName}` : ""}
                {log.internalResistanceMohm != null ? ` · ${log.internalResistanceMohm} mΩ` : ""}
                {log.restingVoltage != null ? ` · ${log.restingVoltage} V` : ""}
                {log.matchKey ? ` · ${log.matchKey}` : ""}{log.note ? ` · ${log.note}` : ""}
              </small>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
