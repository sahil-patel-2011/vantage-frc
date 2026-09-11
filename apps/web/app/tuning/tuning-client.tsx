"use client";
import { Button, EmptyState } from "../../components/ui";
import { useCallback, useEffect, useState } from "react";
import { TUNING_CATEGORIES, TUNING_CATEGORY_LABEL, currentLimitTuningCue, type TuningCategory } from "../../lib/tuning";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Constant = { id: string; subsystem: string; name: string; value: string; unit: string; category: TuningCategory; notes: string; byName: string | null; updatedAt: string };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; constants: Constant[]; summary: { total: number; subsystems: number; byCategory: Record<TuningCategory, number> } };

const EMPTY = { subsystem: "", name: "", value: "", unit: "", category: "encoder_offset", notes: "" };

export default function TuningClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/tuning?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load tuning constants"); setErrorStatus(response.status); setLoadFailed(true); return; }
    setErrorStatus(null);
    setLoadFailed(false);
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/tuning", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function saveConstant(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_constant", seasonYear, ...form }, "Constant saved.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem, category: form.category });
  }

  if (!view) {
    if (!loadFailed) return <main className="intel-app"><p className="telemetry-status">Loading tuning constants…</p></main>;
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
            <span className="eyebrow">VANTAGE / TUNING</span>
            <h1>Tuning constants</h1>
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

  const subsystems = [...new Set(view.constants.map((c) => c.subsystem || "General"))].sort();
  const currentLimitCue = currentLimitTuningCue(view.constants);

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / TUNING</span><h1>Tuning &amp; calibration log — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/subsystems${orgId ? `?orgId=${orgId}` : ""}`}>Subsystems</a><a href={`/code${orgId ? `?orgId=${orgId}` : ""}`}>Code</a><a href="/workspace">Your team →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      {currentLimitCue ? <p className="telemetry-status" role="status">{currentLimitCue}</p> : null}
      <p className="telemetry-status">Record the values that hurt to lose — swerve offsets, PID gains, sensor zeros. A reflash or a lost laptop shouldn&apos;t cost you a day of re-tuning.</p>

      <section className="metric-grid">
        <article><span>Constants logged</span><strong>{view.summary.total}</strong></article>
        <article><span>Subsystems</span><strong>{view.summary.subsystems}</strong></article>
        <article><span>Encoder offsets</span><strong>{view.summary.byCategory.encoder_offset}</strong></article>
        <article><span>PID gain sets</span><strong>{view.summary.byCategory.pid}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={saveConstant}>
          <span className="eyebrow">RECORD A CONSTANT</span>
          <div className="budget-fields">
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Swerve" /></label>
            <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{TUNING_CATEGORIES.map((c) => <option key={c} value={c}>{TUNING_CATEGORY_LABEL[c]}</option>)}</select></label>
          </div>
          <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="FL module offset" /></label>
          <div className="budget-fields">
            <label>Value<input required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0.373" /></label>
            <label>Unit<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="rad" /></label>
          </div>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save constant</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">TIP</span>
          <p>Saving the same subsystem + name again updates it in place, so this always reflects the current tuned value. Keep the notes field for &quot;measured after gearbox swap&quot; context.</p>
        </section>
      </section>

      {subsystems.map((sub) => (
        <section className="intel-panel invite-list" key={sub}>
          <span className="eyebrow">{sub.toUpperCase()}</span>
          {view.constants.filter((c) => (c.subsystem || "General") === sub).map((c) => (
            <article key={c.id}>
              <div style={{ flex: 1 }}>
                <strong>{c.name} = {c.value}{c.unit ? ` ${c.unit}` : ""}</strong>
                <small>{TUNING_CATEGORY_LABEL[c.category]}{c.notes ? ` · ${c.notes}` : ""}{c.byName ? ` · ${c.byName}` : ""}</small>
              </div>
              {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_constant", id: c.id }, "Constant removed.")}>Delete</button>}
            </article>
          ))}
        </section>
      ))}

      {view.constants.length === 0 && <section className="intel-panel"><p>No constants logged yet — start with your swerve module offsets.</p></section>}
    </main>
  );
}
