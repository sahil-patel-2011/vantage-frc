"use client";
import { useCallback, useEffect, useState } from "react";
import { ToolPage, useConfirm, useToast, type ShellState } from "../../components/ui";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildPowerBudgetCall } from "../../lib/learning/surfaces";

type Load = {
  id: string; name: string; subsystem: string; motorCount: number | null;
  typicalAmps: number | null; peakAmps: number | null; breakerAmps: number | null; notes: string; byName: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; loads: Load[]; summary: { count: number; totalTypicalAmps: number; totalPeakAmps: number; tripRisks: string[]; brownoutRisk: boolean; sustainedCeiling: number; breakerSizeCues: string[]; mpmMotorCues: string[]; currentLimitCue: string | null; staggerCue: string | null } };

const EMPTY = { name: "", subsystem: "", motorCount: "", typicalAmps: "", peakAmps: "", breakerAmps: "", notes: "" };

export default function PowerBudgetClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const confirm = useConfirm();
  const toast = useToast();
  const [view, setView] = useState<View | null>(null);
  // Load / mutation failures only — successes go to the toast stack.
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });

  const load = useCallback(async () => {
    const response = await fetch(`/api/power-budget?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load power budget"); setErrorStatus(response.status); return; }
    setErrorStatus(null);
    setMessage("");
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/power-budget", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Request failed"); return; }
    toast.success(okMessage);
    await load();
  }

  async function addLoad(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_load", seasonYear, ...form }, "Load added.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem });
  }

  const ready = view?.status === "ready" ? view : null;
  const s = ready?.summary;
  const breakerCues = s?.breakerSizeCues ?? [];
  const mpmCues = s?.mpmMotorCues ?? [];
  const trip = new Set(s?.tripRisks ?? []);
  const state: ShellState = !view
    ? message
      ? "error"
      : "loading"
    : view.status === "setup_required"
      ? "setup"
      : "ready";

  // Call-your-shot works off the same rows the summary is computed from, so the
  // truth comes from summarizePower() and nothing here recomputes a total.
  const callLoads = (ready?.loads ?? []).map((l) => ({
    name: l.name,
    subsystem: l.subsystem,
    typicalAmps: l.typicalAmps,
    peakAmps: l.peakAmps,
    breakerAmps: l.breakerAmps,
    motorCount: l.motorCount,
    notes: l.notes,
  }));
  const callSignature = JSON.stringify(
    callLoads.map((l) => [l.name, l.typicalAmps, l.peakAmps, l.breakerAmps]),
  );
  const callFieldSet = buildPowerBudgetCall({ loads: callLoads });
  const orgQuery = orgId ? `?orgId=${orgId}` : "";

  return (
    <ToolPage
      hub="build"
      hubTab="power-budget"
      title={`Power & current budget — ${seasonYear}`}
      description="Typical and peak draw per load against the sustained ceiling and each branch breaker — computed from the loads you log, never demo amps."
      className="power-budget-page"
      orgId={ready?.context.orgId ?? orgId}
      state={state}
      error={{ message, status: errorStatus }}
      onRetry={() => void load()}
      setup={{
        title: "Power budget needs a team workspace",
        description: view?.status === "setup_required" ? view.message : undefined,
        children: (
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        ),
      }}
      actions={
        <nav className="product-hub-related intel-actions" aria-label="Related build tools">
          <a href={`/wiring${orgQuery}`}>Wiring</a>
          <a href={`/batteries${orgQuery}`}>Batteries</a>
          <a href="/workspace">Workspace →</a>
        </nav>
      }
    >
      {ready && s ? (
        <>
          {message ? <p className="telemetry-status" role="alert">{message}</p> : null}

          <CallYourShot
            surface="power_budget"
            orgId={ready.context.orgId}
            role={ready.context.role}
            fieldSet={callFieldSet}
            inputs={{ loads: callLoads, sustainedCeiling: s.sustainedCeiling }}
            inputSummary={`${s.count} load${s.count === 1 ? "" : "s"} logged against a ${s.sustainedCeiling} A sustained ceiling`}
            signature={callSignature}
          >
            <section className="metric-grid">
              <article><span>Loads</span><strong>{s.count}</strong></article>
              <article><span>Total typical draw</span><strong>{s.totalTypicalAmps} A</strong></article>
              <article><span>Total peak draw</span><strong>{s.totalPeakAmps} A</strong></article>
              <article><span>Brownout risk</span><strong>{s.brownoutRisk ? "YES" : "no"}</strong></article>
            </section>
            {/* The warnings quote the totals verbatim, so they reveal with them — one
                tap away either way, and "Just show me" is always on screen. */}
            {(s.brownoutRisk || s.tripRisks.length > 0 || breakerCues.length > 0 || mpmCues.length > 0 || Boolean(s.currentLimitCue) || Boolean(s.staggerCue)) && (
              <section className="intel-panel" style={{ borderColor: "#b91c1c" }}>
                <span className="eyebrow">⚠ POWER WARNINGS</span>
                {s.brownoutRisk && <article><div><strong>Brownout risk: {s.totalTypicalAmps} A typical draw exceeds the {s.sustainedCeiling} A sustained ceiling. Expect voltage sag under load.</strong></div></article>}
                {s.currentLimitCue ? <article><div><strong>{s.currentLimitCue}</strong></div></article> : null}
                {s.staggerCue ? <article><div><strong>{s.staggerCue}</strong></div></article> : null}
                {s.tripRisks.map((name) => <article key={name}><div><strong>{name}: peak current exceeds its branch breaker — it will trip.</strong></div></article>)}
                {breakerCues.map((cue) => <article key={cue}><div><strong>{cue}</strong></div></article>)}
                {mpmCues.map((cue) => <article key={cue}><div><strong>{cue}</strong></div></article>)}
              </section>
            )}
          </CallYourShot>

          <section className="admin-grid">
            <form className="intel-panel" onSubmit={addLoad}>
              <span className="eyebrow">ADD A LOAD</span>
              <div className="budget-fields">
                <label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Drivetrain" /></label>
                <label>Subsystem<input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} /></label>
              </div>
              <div className="budget-fields">
                <label>Motors<input type="number" min="0" value={form.motorCount} onChange={(e) => setForm({ ...form, motorCount: e.target.value })} /></label>
                <label>Breaker (A)<input type="number" min="0" value={form.breakerAmps} onChange={(e) => setForm({ ...form, breakerAmps: e.target.value })} placeholder="40" /></label>
              </div>
              <div className="budget-fields">
                <label>Typical (A)<input type="number" min="0" step="0.1" value={form.typicalAmps} onChange={(e) => setForm({ ...form, typicalAmps: e.target.value })} placeholder="40" /></label>
                <label>Peak (A)<input type="number" min="0" step="0.1" value={form.peakAmps} onChange={(e) => setForm({ ...form, peakAmps: e.target.value })} placeholder="120" /></label>
              </div>
              <label>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <button className="primary-action">Add load</button>
            </form>
            <section className="intel-panel">
              <span className="eyebrow">HOW TO READ IT</span>
              <p>Typical draw is your running average; keep it under ~{s.sustainedCeiling} A to avoid brownouts on a fresh battery. Peak is the worst-case per branch — if it tops the branch breaker, that breaker trips and you lose the mechanism mid-match.</p>
            </section>
          </section>

          <section className="intel-panel invite-list">
            <span className="eyebrow">LOADS</span>
            {ready.loads.length === 0 && <p>No loads yet — add your drivetrain and mechanisms.</p>}
            {ready.loads.map((l) => (
              <article key={l.id}>
                <div style={{ flex: 1 }}>
                  <strong>{l.name}{l.motorCount ? ` · ${l.motorCount} motors` : ""}{trip.has(l.name) ? " ⚠" : ""}</strong>
                  <small>
                    {l.typicalAmps != null ? `${l.typicalAmps}A typical` : "no typical"}
                    {l.peakAmps != null ? ` · ${l.peakAmps}A peak` : ""}
                    {l.breakerAmps != null ? ` · ${l.breakerAmps}A breaker` : ""}
                    {l.subsystem ? ` · ${l.subsystem}` : ""}{l.notes ? ` · ${l.notes}` : ""}
                  </small>
                </div>
                {ready.context.role !== "viewer" && (
                  <button
                    type="button"
                    onClick={() => {
                      void confirm({
                        title: "Delete load",
                        body: `Remove "${l.name}" from the ${seasonYear} power budget? Typical and peak totals recompute without it.`,
                        confirmLabel: "Delete load",
                        tone: "destructive",
                      }).then((ok) => {
                        if (ok) void post({ action: "delete_load", id: l.id }, "Load removed.");
                      });
                    }}
                  >
                    Delete
                  </button>
                )}
              </article>
            ))}
          </section>
        </>
      ) : null}
    </ToolPage>
  );
}
