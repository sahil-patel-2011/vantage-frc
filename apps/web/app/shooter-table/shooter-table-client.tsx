"use client";
import { useCallback, useEffect, useState } from "react";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildShooterCall } from "../../lib/learning/surfaces";
import { interpolateShot, SHOOTER_EXPORT_LANGUAGES, type ShooterExportLanguage } from "../../lib/shooter-table";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Point = { id: string; tableName: string; distanceFt: number; rpm: number | null; hoodAngle: number | null; notes: string };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; points: Point[]; summary: { count: number; minDistanceFt: number | null; maxDistanceFt: number | null } };

const EMPTY = { distanceFt: "", rpm: "", hoodAngle: "", notes: "" };

export default function ShooterTableClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [query, setQuery] = useState("");
  const [exportLang, setExportLang] = useState<ShooterExportLanguage>("java");

  const load = useCallback(async () => {
    const response = await fetch(`/api/shooter-table?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setErrorStatus(response.status); setMessage(data.error ?? "Failed to load shooter table"); return; }
    setErrorStatus(null);
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

  if (!view) {
    if (!message) return <main className="intel-app"><p className="telemetry-status">Loading shooter table…</p></main>;
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
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / SHOOTER</span><h1>Shooter table</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const queryFt = Number(query);
  const callPoints = view.points.map((p) => ({ distanceFt: p.distanceFt, rpm: p.rpm, hoodAngle: p.hoodAngle }));
  const shot = query !== "" && Number.isFinite(queryFt) ? interpolateShot(callPoints, queryFt) : null;
  // A new distance is a new shot to call; so is any change to the calibration.
  const callSignature = JSON.stringify({
    distanceFt: queryFt,
    points: callPoints.map((p) => [p.distanceFt, p.rpm, p.hoodAngle]),
  });
  const callFieldSet = buildShooterCall({ points: callPoints, distanceFt: queryFt });
  const exportHref = `/api/shooter-table/export?orgId=${encodeURIComponent(view.context.orgId)}&seasonYear=${seasonYear}&lang=${exportLang}`;
  const rpmLogged = view.points.filter((p) => p.rpm != null).length;
  const hoodLogged = view.points.filter((p) => p.hoodAngle != null).length;

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
            <CallYourShot
              surface="shooter_table"
              orgId={view.context.orgId}
              role={view.context.role}
              fieldSet={callFieldSet}
              inputs={{ distanceFt: queryFt, points: callPoints }}
              inputSummary={`${view.summary.count} calibrated point${view.summary.count === 1 ? "" : "s"}, reading ${queryFt} ft`}
              signature={callSignature}
            >
              <p className="telemetry-status success">
                At {queryFt} ft → {shot.rpm != null ? `${shot.rpm} RPM` : "no RPM data"}{shot.hoodAngle != null ? ` · ${shot.hoodAngle}° hood` : ""}
                {shot.extrapolated ? " (extrapolated — outside calibrated range)" : ""}
              </p>
            </CallYourShot>
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

      <section className="intel-panel">
        <span className="eyebrow">ROBOT CODE</span>
        <p>
          Download constants built only from logged RPM and hood rows. Missing fields stay missing —
          this file does not interpolate or invent flywheel RPM.
        </p>
        <label>
          Language
          <select value={exportLang} onChange={(e) => setExportLang(e.target.value as ShooterExportLanguage)}>
            {SHOOTER_EXPORT_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang === "java" ? "Java (WPILib)" : lang === "cpp" ? "C++" : "Python"}
              </option>
            ))}
          </select>
        </label>
        <p>
          <a className="primary-action" href={exportHref}>
            Download constants
          </a>
        </p>
        <p>
          <small>
            {view.points.length === 0
              ? "No logged points yet — the download is an empty table, not sample RPM."
              : `${rpmLogged} RPM row${rpmLogged === 1 ? "" : "s"}, ${hoodLogged} hood row${hoodLogged === 1 ? "" : "s"} will be written. Lookup interpolation on this page is not included.`}
          </small>
        </p>
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
