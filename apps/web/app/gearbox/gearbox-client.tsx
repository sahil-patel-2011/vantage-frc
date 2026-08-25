"use client";
import { useCallback, useEffect, useState } from "react";
import { compoundReduction, describeStages, outputRpm, type Stage } from "../../lib/gearbox";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildGearboxCall } from "../../lib/learning/surfaces";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Gearbox = { id: string; name: string; subsystem: string; stages: Stage[]; motorFreeRpm: number | null; notes: string; byName: string | null; reduction: number; outputRpm: number | null };
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; gearboxes: Gearbox[] };

type StageDraft = { driving: string; driven: string };
const EMPTY = { name: "", subsystem: "", motorFreeRpm: "", notes: "" };

export default function GearboxClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a bare error line.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [stages, setStages] = useState<StageDraft[]>([{ driving: "", driven: "" }]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/gearbox?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    setLoadError("");
    setErrorStatus(null);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Failed to load gearboxes");
      setLoadError(data.error ?? "Failed to load gearboxes");
      setErrorStatus(response.status);
      return;
    }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/gearbox", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  const parsedStages: Stage[] = stages
    .map((s) => ({ driving: Number(s.driving), driven: Number(s.driven) }))
    .filter((s) => s.driving > 0 && s.driven > 0);
  const previewReduction = parsedStages.length ? compoundReduction(parsedStages) : null;
  const freeRpm = Number(form.motorFreeRpm) > 0 ? Number(form.motorFreeRpm) : null;
  const previewOut = previewReduction && freeRpm != null ? outputRpm(freeRpm, previewReduction) : null;
  // The signature is the whole design: change a tooth count and it is a new shot to call.
  const callSignature = JSON.stringify({ stages: parsedStages, freeRpm });
  const callFieldSet = buildGearboxCall({ stages: parsedStages, motorFreeRpm: freeRpm });

  async function saveGearbox(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_gearbox", seasonYear, ...form, stages: parsedStages }, "Gearbox saved.");
    if (view?.status === "ready") { setForm({ ...EMPTY }); setStages([{ driving: "", driven: "" }]); }
  }

  if (!view) {
    // Retry cannot fix an expired session, so the failure decides its own action.
    const failure = loadError
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError,
          },
        )
      : null;
    return (
      <main className="intel-app">
        <p className="telemetry-status">
          {failure ? (
            <>
              <strong>{failure.title}</strong> — {failure.description}
            </>
          ) : (
            message || "Loading gearboxes…"
          )}
        </p>
        {failure?.primary ? (
          <p>
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          </p>
        ) : null}
        {failure?.showRetry ? (
          <p>
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : null}
      </main>
    );
  }
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / GEARBOX</span><h1>Gearbox calculator</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / GEARBOX</span><h1>Gearbox ratio calculator — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/subsystems${orgId ? `?orgId=${orgId}` : ""}`}>Subsystems</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={saveGearbox}>
          <span className="eyebrow">DESIGN A GEARBOX</span>
          <div className="budget-fields">
            <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="SDS MK4i L2" /></label>
            <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Drivetrain" /></label>
          </div>
          <span className="eyebrow">STAGES (driving : driven teeth)</span>
          {stages.map((s, i) => (
            <div className="budget-fields" key={i}>
              <label>Driving<input type="number" min="1" value={s.driving} onChange={(e) => setStages(stages.map((x, j) => j === i ? { ...x, driving: e.target.value } : x))} /></label>
              <label>Driven<input type="number" min="1" value={s.driven} onChange={(e) => setStages(stages.map((x, j) => j === i ? { ...x, driven: e.target.value } : x))} /></label>
              {stages.length > 1 && <button type="button" onClick={() => setStages(stages.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          {stages.length < 8 && <button type="button" onClick={() => setStages([...stages, { driving: "", driven: "" }])}>+ Add stage</button>}
          <label>Motor free RPM (optional)<input type="number" min="0" value={form.motorFreeRpm} onChange={(e) => setForm({ ...form, motorFreeRpm: e.target.value })} placeholder="6000" /></label>
          <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="primary-action">Save gearbox</button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">HOW IT WORKS</span>
          <p>Each stage&apos;s ratio is driven ÷ driving teeth; the compound reduction is all stages multiplied. Output speed is motor RPM ÷ reduction, and output torque multiplies by the reduction (before efficiency losses).</p>
        </section>
      </section>

      {previewReduction != null && (
        <section className="intel-panel">
          <CallYourShot
            surface="gearbox"
            orgId={view.context.orgId}
            role={view.context.role}
            fieldSet={callFieldSet}
            inputs={{ stages: parsedStages, motorFreeRpm: freeRpm }}
            inputSummary={`${describeStages(parsedStages)}${freeRpm != null ? ` from a ${freeRpm} RPM free speed` : ""}`}
            signature={callSignature}
          >
            <p className="telemetry-status success">
              Compound reduction: {previewReduction}:1{previewOut != null ? ` · output ${previewOut} RPM` : ""} · torque ×{previewReduction}
            </p>
          </CallYourShot>
        </section>
      )}

      <section className="intel-panel invite-list">
        <span className="eyebrow">SAVED GEARBOXES</span>
        {view.gearboxes.length === 0 && <p>No gearboxes yet — design your drivetrain reduction above.</p>}
        {view.gearboxes.map((g) => (
          <article key={g.id}>
            <div style={{ flex: 1 }}>
              <strong>{g.name} · {g.reduction}:1{g.outputRpm != null ? ` · ${g.outputRpm} RPM out` : ""}</strong>
              <small>{describeStages(g.stages)}{g.subsystem ? ` · ${g.subsystem}` : ""}{g.notes ? ` · ${g.notes}` : ""}</small>
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_gearbox", id: g.id }, "Gearbox removed.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
