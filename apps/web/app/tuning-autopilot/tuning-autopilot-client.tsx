"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TUNING_CONTROLLER_TYPES, tuningControllerTypeLabel, tuningSessionStatusLabel } from "../../lib/tuning-autopilot";
import type { TuningAutopilotView } from "../../lib/tuning-autopilot/compute-tuning-autopilot";
import type { TuningControllerType, TuningSessionStatus } from "../../lib/tuning-autopilot/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function scoreTone(score: number): string {
  if (score >= 0.75) return "good";
  if (score >= 0.4) return "setup";
  return "demo";
}

type LiveView = Extract<TuningAutopilotView, { status: "live" }>;

export default function TuningAutopilotClient() {
  const [view, setView] = useState<TuningAutopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((overrides?: { seasonYear?: number; sessionId?: string | null }) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = overrides?.seasonYear ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    if (overrides?.sessionId) query.set("sessionId", overrides.sessionId);
    void fetch(`/api/tuning-autopilot${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as TuningAutopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/tuning-autopilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as TuningAutopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Tuning Autopilot"}
          </>
        }
        title="Tuning Autopilot"
        description="Log each PID/feedforward gain set you try and its test result. The next gain set is suggested from your own logged trend — never invented."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load({ seasonYear: next });
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the tuning autopilot"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SessionSwitcher view={view} busy={busy} onSelect={(sessionId) => load({ sessionId })} mutate={mutate} />
          <NewSessionForm busy={busy} mutate={mutate} />
          {view.selectedSessionId ? (
            <>
              <SuggestionPanel view={view} />
              <LogIterationForm view={view} busy={busy} mutate={mutate} />
              <IterationHistory view={view} busy={busy} mutate={mutate} />
            </>
          ) : (
            <EmptyState
              badge="No sessions yet"
              badgeTone="setup"
              title="Start your first tuning session"
              description="Pick a subsystem and controller type above, then log the gain sets you try and the observed test result."
            />
          )}
        </div>
      )}
    </main>
  );
}

function SessionSwitcher({
  view,
  busy,
  onSelect,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  onSelect: (sessionId: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sessions.length === 0) return null;
  const selected = view.sessions.find((s) => s.session.id === view.selectedSessionId) ?? null;
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Sessions</h2>
          <small className="app-muted">One session per subsystem/controller you're tuning this season.</small>
        </div>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Session
          <select value={view.selectedSessionId ?? ""} onChange={(event) => onSelect(event.target.value)}>
            {view.sessions.map((row) => (
              <option key={row.session.id} value={row.session.id}>
                {row.session.subsystem} — {tuningControllerTypeLabel(row.session.controllerType)} (
                {tuningSessionStatusLabel(row.session.status)})
              </option>
            ))}
          </select>
        </label>
      </header>
      {selected ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <span className="app-muted">{selected.session.goal || "No goal recorded."}</span>
          <span className="app-muted">{selected.iterationCount} iteration(s)</span>
          {selected.bestScore != null ? (
            <span className={`app-badge ${scoreTone(selected.bestScore)}`}>Best {pct(selected.bestScore)}</span>
          ) : null}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {selected.session.status !== "converged" ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => mutate({ action: "update-session-status", sessionId: selected.session.id, status: "converged" })}
              >
                Mark converged
              </button>
            ) : null}
            {selected.session.status !== "abandoned" ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() => mutate({ action: "update-session-status", sessionId: selected.session.id, status: "abandoned" })}
              >
                Abandon
              </button>
            ) : null}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete session "${selected.session.subsystem}" and all its iterations?`)) {
                  mutate({ action: "delete-session", sessionId: selected.session.id });
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function NewSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ subsystem: "", controllerType: "pid" as TuningControllerType, goal: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.subsystem.trim()) return;
        mutate({
          action: "create-session",
          subsystem: form.subsystem,
          controllerType: form.controllerType,
          goal: form.goal || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>New tuning session</h2>
      <FormGrid min={160}>
        <FormRow label="Subsystem">
          <input value={form.subsystem} onChange={set("subsystem")} placeholder="Arm, Shooter, Drivetrain…" required />
        </FormRow>
        <FormRow label="Controller">
          <select value={form.controllerType} onChange={set("controllerType")}>
            {TUNING_CONTROLLER_TYPES.map((type) => (
              <option key={type} value={type}>
                {tuningControllerTypeLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Goal (optional)">
          <input value={form.goal} onChange={set("goal")} placeholder="No overshoot, settle under 0.5s" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.subsystem.trim()}>
          Start session
        </button>
      </div>
    </Panel>
  );
}

function SuggestionPanel({ view }: { view: LiveView }) {
  const { suggestion } = view;
  return (
    <Panel aria-label="Next gain suggestion">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          {suggestion ? (
            <span className={`app-badge ${suggestion.converged ? "good" : "setup"}`}>
              {suggestion.converged ? "Converged" : "Suggested next gains"}
            </span>
          ) : (
            <span className="app-badge demo">No iterations yet</span>
          )}
          <h2 style={{ margin: "6px 0 0" }}>Next gain set</h2>
        </div>
        {suggestion ? <small className="app-muted">Confidence {pct(suggestion.confidence)}</small> : null}
      </header>
      {suggestion ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(80px, 1fr))",
              gap: 10,
              marginTop: 12,
            }}
          >
            {(["kP", "kI", "kD", "kS", "kV", "kG"] as const).map((key) => (
              <div key={key}>
                <strong style={{ display: "block", fontSize: "1.2rem" }}>{suggestion.gains[key]}</strong>
                <span className="app-muted">{key}</span>
              </div>
            ))}
          </div>
          <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
            {suggestion.rationale.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>
          Log your first iteration below to get a suggested next gain set.
        </p>
      )}
    </Panel>
  );
}

function LogIterationForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      kP: "",
      kI: "",
      kD: "",
      kS: "",
      kV: "",
      kG: "",
      overshootPct: "",
      settlingTimeSec: "",
      steadyStateError: "",
      oscillating: false,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!view.selectedSessionId) return;
        mutate({
          action: "log-iteration",
          sessionId: view.selectedSessionId,
          gains: {
            kP: Number(form.kP) || 0,
            kI: Number(form.kI) || 0,
            kD: Number(form.kD) || 0,
            kS: Number(form.kS) || 0,
            kV: Number(form.kV) || 0,
            kG: Number(form.kG) || 0,
          },
          overshootPct: Number(form.overshootPct) || 0,
          settlingTimeSec: Number(form.settlingTimeSec) || 0,
          steadyStateError: Number(form.steadyStateError) || 0,
          oscillating: form.oscillating,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log iteration</h2>
      <FormGrid min={100}>
        <FormRow label="kP">
          <input type="number" step="any" value={form.kP} onChange={set("kP")} />
        </FormRow>
        <FormRow label="kI">
          <input type="number" step="any" value={form.kI} onChange={set("kI")} />
        </FormRow>
        <FormRow label="kD">
          <input type="number" step="any" value={form.kD} onChange={set("kD")} />
        </FormRow>
        <FormRow label="kS">
          <input type="number" step="any" value={form.kS} onChange={set("kS")} />
        </FormRow>
        <FormRow label="kV">
          <input type="number" step="any" value={form.kV} onChange={set("kV")} />
        </FormRow>
        <FormRow label="kG">
          <input type="number" step="any" value={form.kG} onChange={set("kG")} />
        </FormRow>
      </FormGrid>
      <FormGrid min={160}>
        <FormRow label="Overshoot (%)">
          <input type="number" min={0} step="any" value={form.overshootPct} onChange={set("overshootPct")} />
        </FormRow>
        <FormRow label="Settling time (s)">
          <input type="number" min={0} step="any" value={form.settlingTimeSec} onChange={set("settlingTimeSec")} />
        </FormRow>
        <FormRow label="Steady-state error">
          <input type="number" min={0} step="any" value={form.steadyStateError} onChange={set("steadyStateError")} />
        </FormRow>
      </FormGrid>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.oscillating}
          onChange={(event) => setForm((prev) => ({ ...prev, oscillating: event.target.checked }))}
        />
        Response oscillated
      </label>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy}>
          Log iteration
        </button>
      </div>
    </Panel>
  );
}

function IterationHistory({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.iterations.length === 0) {
    return (
      <EmptyState
        badge="No iterations yet"
        badgeTone="setup"
        title="Log your first gain set and test result"
        description="Each iteration you log sharpens the next-gain suggestion above."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Iteration history</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {[...view.iterations].reverse().map((iteration) => (
          <li
            key={iteration.id}
            className="app-card soft-panel"
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${scoreTone(iteration.score)}`}>
                #{iteration.iterationIndex} · {pct(iteration.score)}
                {iteration.id === view.bestIterationId ? " · best" : ""}
              </span>
              <strong style={{ display: "block", marginTop: 4 }}>
                kP {iteration.gains.kP} · kI {iteration.gains.kI} · kD {iteration.gains.kD}
                {iteration.gains.kS || iteration.gains.kV || iteration.gains.kG
                  ? ` · kS ${iteration.gains.kS} · kV ${iteration.gains.kV} · kG ${iteration.gains.kG}`
                  : ""}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                Overshoot {iteration.result.overshootPct}% · settle {iteration.result.settlingTimeSec}s · error{" "}
                {iteration.result.steadyStateError}
                {iteration.result.oscillating ? " · oscillating" : ""}
              </small>
              {iteration.notes ? <small className="app-muted">{iteration.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "delete-iteration", iterationId: iteration.id, sessionId: view.selectedSessionId })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
