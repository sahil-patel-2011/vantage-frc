"use client";
import { useCallback, useEffect, useState } from "react";
import { COMMON_COMPONENTS, VERSION_CATEGORIES, VERSION_CATEGORY_LABEL, inspectionDsCue, inspectionRioImageCue, staleSeasonStackCue, vh109DipSwitchCue, vh109FirmwareCue, type VersionCategory, type VersionStatus } from "../../lib/software-versions";

import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Component = {
  id: string; component: string; category: VersionCategory; installedVersion: string;
  targetVersion: string | null; notes: string; byName: string | null; updatedAt: string; status: VersionStatus;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; components: Component[]; summary: { total: number; ok: number; updateAvailable: number; unknown: number } };

const STATUS_LABEL: Record<VersionStatus, string> = { ok: "Up to date", update_available: "Update available", unknown: "No target set" };
const EMPTY = { component: "", category: "library", installedVersion: "", targetVersion: "", notes: "" };

export default function SoftwareVersionsClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/software-versions?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setErrorStatus(response.status); setMessage(data.error ?? "Failed to load software versions"); return; }
    setErrorStatus(null);
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/software-versions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_component", seasonYear, ...form }, "Saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  if (!view) {
    if (!message) return <main className="intel-app"><p className="telemetry-status">Loading software versions…</p></main>;
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
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / SOFTWARE</span><h1>Software versions</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const existing = new Set(view.components.map((c) => c.component));
  const radioFirmwareCue = vh109FirmwareCue(view.components);
  const radioDipCue = vh109DipSwitchCue(view.components);
  const seasonStackCue = staleSeasonStackCue(view.components, view.seasonYear);
  const rioImageCue = inspectionRioImageCue(view.components, view.seasonYear);
  const dsCue = inspectionDsCue(view.components, view.seasonYear);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / SOFTWARE</span><h1>Software &amp; firmware versions — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/wiring${orgId ? `?orgId=${orgId}` : ""}`}>Wiring</a><a href={`/code${orgId ? `?orgId=${orgId}` : ""}`}>Code</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      {radioFirmwareCue ? <p className="telemetry-status" role="status">{radioFirmwareCue}</p> : null}
      {radioDipCue ? <p className="telemetry-status" role="status">{radioDipCue}</p> : null}
      {seasonStackCue ? <p className="telemetry-status" role="status">{seasonStackCue}</p> : null}
      {rioImageCue ? <p className="telemetry-status" role="status">{rioImageCue}</p> : null}
      {dsCue ? <p className="telemetry-status" role="status">{dsCue}</p> : null}

      <section className="metric-grid">
        <article><span>Components tracked</span><strong>{view.summary.total}</strong></article>
        <article><span>Up to date</span><strong>{view.summary.ok}</strong></article>
        <article><span>Update available</span><strong>{view.summary.updateAvailable}</strong></article>
        <article><span>No target set</span><strong>{view.summary.unknown}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={save}>
          <span className="eyebrow">RECORD A VERSION</span>
          <label>Component<input required value={form.component} onChange={(e) => setForm({ ...form, component: e.target.value })} placeholder="WPILib" /></label>
          <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{VERSION_CATEGORIES.map((c) => <option key={c} value={c}>{VERSION_CATEGORY_LABEL[c]}</option>)}</select></label>
          <div className="budget-fields">
            <label>Installed<input required value={form.installedVersion} onChange={(e) => setForm({ ...form, installedVersion: e.target.value })} placeholder="2026.1.1" /></label>
            <label>Target<input value={form.targetVersion} onChange={(e) => setForm({ ...form, targetVersion: e.target.value })} placeholder="2026.2.0" /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save version</button>
          <p><small>Quick add: {COMMON_COMPONENTS.filter((c) => !existing.has(c.name)).slice(0, 8).map((c) => <a key={c.name} href="#" onClick={(e) => { e.preventDefault(); setForm({ ...EMPTY, component: c.name, category: c.category }); }} style={{ marginRight: 8 }}>{c.name}</a>)}</small></p>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">WHY THIS MATTERS</span>
          <p>A mismatch between vendor libraries, the roboRIO image, and device firmware is a classic source of &quot;it worked yesterday&quot; robot bugs. Set a target version for each component and this flags anything that drifts.</p>
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">COMPONENTS</span>
        {view.components.length === 0 && <p>No versions recorded yet — start with WPILib and your vendordeps.</p>}
        {view.components.map((c) => (
          <article key={c.id}>
            <div style={{ flex: 1 }}>
              <strong>{c.component} · {c.installedVersion}</strong>
              <small>{VERSION_CATEGORY_LABEL[c.category]}{c.targetVersion ? ` · target ${c.targetVersion}` : ""} · {STATUS_LABEL[c.status]}{c.byName ? ` · ${c.byName}` : ""}{c.notes ? ` · ${c.notes}` : ""}</small>
            </div>
            <div>
              {c.status === "update_available" && <b>UPDATE</b>}
              {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_component", id: c.id }, "Removed.")}>Delete</button>}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
