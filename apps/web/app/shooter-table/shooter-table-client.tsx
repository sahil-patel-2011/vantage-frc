"use client";
import { useCallback, useEffect, useState } from "react";
import { interpolateShot } from "../../lib/shooter-table";

type Point = { id: string; tableName: string; distanceFt: number; rpm: number | null; hoodAngle: number | null; notes: string };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; points: Point[]; summary: { count: number; minDistanceFt: number | null; maxDistanceFt: number | null } };

const EMPTY = { distanceFt: "", rpm: "", hoodAngle: "", notes: "" };

export default function ShooterTableClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/shooter-table?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load shooter table"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/shooter-table", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function savePoint(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_point", seasonYear, tableName: "Shooter", ...form }, "Point saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading shooter table…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / SHOOTER</span><h1>Shooter table</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const queryFt = Number(query);
  const shot = query !== "" && Number.isFinite(queryFt)
    ? interpolateShot(view.points.map((p) => ({ distanceFt: p.distanceFt, rpm: p.rpm, hoodAngle: p.hoodAngle })), queryFt)
    : null;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / SHOOTER</span><h1>Shooter lookup table — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/subsystems${orgId ? `?orgId=${orgId}` : ""}`}>Subsystems</a><a href={`/tuning${orgId ? `?orgId=${orgId}` : ""}`}>Tuning</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="metric-grid">
        <article><span>Calibrated points</span><strong>{view.summary.count}</strong></article>
        <article><span>Range</span><strong>{view.summary.minDistanceFt != null ? `${view.summary.minDistanceFt}–${view.summary.maxDistanceFt} ft` : "—"}</strong></article>
      </section>

      <section className="admin-grid">
        <section className="intel-panel">
          <span className="eyebrow">LOOK UP A SHOT</span>
          <label>Distance (ft)<input type="number" min="0" step="0.1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="12.5" /></label>
          {shot && (
            <p className="telemetry-status success">
              At {queryFt} ft → {shot.rpm != null ? `${shot.rpm} RPM` : "no RPM data"}{shot.hoodAngle != null ? ` · ${shot.hoodAngle}° hood` : ""}
              {shot.extrapolated ? " (extrapolated — outside calibrated range)" : ""}
            </p>
          )}
          <p><small>Values are linearly interpolated between your calibrated points. Add more points to tighten accuracy across the field.</small></p>
        </section>

        <form className="intel-panel" onSubmit={savePoint}>
          <span className="eyebrow">ADD / UPDATE A POINT</span>
          <label>Distance (ft)<input required type="number" min="0" step="0.1" value={form.distanceFt} onChange={(e) => setForm({ ...form, distanceFt: e.target.value })} /></label>
          <div className="budget-fields">
            <label>Flywheel RPM<input type="number" min="0" value={form.rpm} onChange={(e) => setForm({ ...form, rpm: e.target.value })} /></label>
            <label>Hood angle (°)<input type="number" min="0" step="0.1" value={form.hoodAngle} onChange={(e) => setForm({ ...form, hoodAngle: e.target.value })} /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save point</button>
        </form>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">CALIBRATED POINTS</span>
        {view.points.length === 0 && <p>No points yet — shoot from a few known distances and log RPM/angle here.</p>}
        {view.points.map((p) => (
          <article key={p.id}>
            <div style={{ flex: 1 }}>
              <strong>{p.distanceFt} ft → {p.rpm != null ? `${p.rpm} RPM` : "—"}{p.hoodAngle != null ? ` · ${p.hoodAngle}°` : ""}</strong>
              {p.notes && <small>{p.notes}</small>}
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_point", id: p.id }, "Point removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
