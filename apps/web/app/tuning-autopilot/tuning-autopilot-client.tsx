"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TUNING_CONTROLLER_TYPES, tuningControllerTypeLabel, tuningSessionStatusLabel } from "../../lib/tuning-autopilot";
import type { TuningAutopilotView } from "../../lib/tuning-autopilot/compute-tuning-autopilot";
import {
  classifyTuningAutopilotShell,
  formatTuningAutopilotMetric,
  formatTuningScorePct,
  tuningAutopilotShellCopy,
  type TuningAutopilotShellKind,
} from "../../lib/tuning-autopilot/tuning-autopilot-related";
import type { TuningControllerType } from "../../lib/tuning-autopilot/types";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./tuning-autopilot.css";

function scoreTone(score: number): string {
  if (score >= 0.75) return "good";
  if (score >= 0.4) return "setup";
  return "danger";
}

type LiveView = Extract<TuningAutopilotView, { status: "live" }>;

function TuningShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  shell: TuningAutopilotShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const copy = tuningAutopilotShellCopy(shell);

  return (
    <main className="module-page tuning-autopilot-page soft-gate">
      <PageHeader
        breadcrumbs="Build / Tuning Autopilot"
        title="Tuning Autopilot"
        description={description}
      />
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No sessions yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button" href="#tuning-autopilot-new-session">
            Start a session
          </a>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function TuningAutopilotClient() {
  const [view, setView] = useState<TuningAutopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sessionCount = view?.status === "live" ? view.sessions.length : 0;
  const iterationCount = view?.status === "live" ? view.iterations.length : 0;
  const activeCount =
    view?.status === "live"
      ? view.sessions.filter((row) => row.session.status === "active").length
      : 0;
  const bestScore =
    view?.status === "live"
      ? (view.sessions.find((row) => row.session.id === view.selectedSessionId)?.bestScore ?? null)
      : null;

  const shell = classifyTuningAutopilotShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    sessionCount,
  });
  const shellCopy = tuningAutopilotShellCopy(shell);

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

  if (shell === "loading") {
    return <TuningShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <TuningShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <TuningShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <TuningShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page tuning-autopilot-page">
      <PageHeader
        breadcrumbs="Build / Tuning Autopilot"
        title="Tuning Autopilot"
        description="Log each PID/feedforward gain set you try and its test result. The next gain set is suggested from your own logged trend — never DEMO gain metrics. Cross-check CAD, FMEA, and Practice."
      >
        <div className="tuning-autopilot-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted tuning-autopilot-season">
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <SummaryTiles
        sessionCount={sessionCount}
        activeCount={activeCount}
        iterationCount={iterationCount}
        bestScore={bestScore}
        loaded
      />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sessions yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#tuning-autopilot-new-session">
            Start a session
          </a>
        </EmptyState>
      ) : null}

      <div className="tuning-autopilot-layout">
        <SessionSwitcher view={view} busy={busy} onSelect={(sessionId) => load({ sessionId })} mutate={mutate} />
        <NewSessionForm busy={busy} mutate={mutate} />
        {shell === "ready" && view.selectedSessionId ? (
          <>
            <SuggestionPanel view={view} />
            <LogIterationForm view={view} busy={busy} mutate={mutate} />
            <IterationHistory view={view} busy={busy} mutate={mutate} />
          </>
        ) : null}
        {shell === "ready" && !view.selectedSessionId ? (
          <EmptyState
            soft
            badge="No sessions yet"
            badgeTone="setup"
            title="Start your first tuning session"
            description="Pick a subsystem and controller type above, then log the gain sets you try and the observed test result — never DEMO scores."
          />
        ) : null}
      </div>
    </main>
  );
}

function SummaryTiles({
  sessionCount,
  activeCount,
  iterationCount,
  bestScore,
  loaded,
}: {
  sessionCount: number;
  activeCount: number;
  iterationCount: number;
  bestScore: number | null;
  loaded: boolean;
}) {
  const hasIterations = iterationCount > 0;
  const tiles = [
    { label: "Sessions", value: formatTuningAutopilotMetric(sessionCount, loaded) },
    { label: "Active", value: formatTuningAutopilotMetric(activeCount, loaded) },
    { label: "Iterations", value: formatTuningAutopilotMetric(iterationCount, loaded) },
    {
      label: "Best score",
      value: formatTuningScorePct(bestScore, loaded, hasIterations),
    },
  ];
  return (
    <Panel className="tuning-autopilot-coverage" aria-label="Tuning Autopilot summary">
      <div className="tuning-autopilot-stats">
        <div>
          <span
            className={`app-badge ${
              sessionCount === 0 ? "setup" : hasIterations ? "good" : "setup"
            }`}
          >
            {sessionCount === 0 ? "EMPTY" : hasIterations ? "LOGGING" : "NO ITERATIONS"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season tuning</h2>
          <small className="app-muted">Logged gain sets only — never DEMO gain metrics</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
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
    <Panel className="tuning-autopilot-panel" id="tuning-autopilot-sessions">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Sessions</h2>
          <small className="app-muted">One session per subsystem/controller you&apos;re tuning this season.</small>
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
        <div className="tuning-autopilot-session-meta">
          <span className="app-muted">{selected.session.goal || "No goal recorded."}</span>
          <span className="app-muted">
            {formatTuningAutopilotMetric(selected.iterationCount, true)} iteration(s)
          </span>
          {selected.bestScore != null ? (
            <span className={`app-badge ${scoreTone(selected.bestScore)}`}>
              Best {formatTuningScorePct(selected.bestScore, true, true)}
            </span>
          ) : null}
          <div className="tuning-autopilot-session-actions">
            {selected.session.status !== "converged" ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  mutate({ action: "update-session-status", sessionId: selected.session.id, status: "converged" })
                }
              >
                Mark converged
              </button>
            ) : null}
            {selected.session.status !== "abandoned" ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  mutate({ action: "update-session-status", sessionId: selected.session.id, status: "abandoned" })
                }
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
      id="tuning-autopilot-new-session"
      as="form"
      className="tuning-autopilot-panel"
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
    >
      <h2 style={{ margin: 0 }}>New tuning session</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Name a real subsystem — suggestions stay blank until you log iterations.
      </p>
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
    <Panel id="tuning-autopilot-suggestion" className="tuning-autopilot-panel" aria-label="Next gain suggestion">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          {suggestion ? (
            <span className={`app-badge ${suggestion.converged ? "good" : "setup"}`}>
              {suggestion.converged ? "Converged" : "Suggested next gains"}
            </span>
          ) : (
            <span className="app-badge setup">No iterations yet</span>
          )}
          <h2 style={{ margin: "6px 0 0" }}>Next gain set</h2>
        </div>
        {suggestion ? (
          <small className="app-muted">
            Confidence {formatTuningScorePct(suggestion.confidence, true, true)}
          </small>
        ) : null}
      </header>
      {suggestion ? (
        <>
          <div className="tuning-autopilot-gains">
            {(["kP", "kI", "kD", "kS", "kV", "kG"] as const).map((key) => (
              <div key={key}>
                <strong>{suggestion.gains[key]}</strong>
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
          Log your first iteration below to get a suggested next gain set — never DEMO setpoints.
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
      id="tuning-autopilot-log-iteration"
      as="form"
      className="tuning-autopilot-panel"
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
    >
      <h2 style={{ margin: 0 }}>Log iteration</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Enter the gain set you tried and the observed test result — predictions stay blank until you submit.
      </p>
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
        soft
        badge="No iterations yet"
        badgeTone="setup"
        title="Log your first gain set and test result"
        description="Each iteration you log sharpens the next-gain suggestion above — never DEMO scores."
      >
        <a className="app-button" href="#tuning-autopilot-log-iteration">
          Log iteration
        </a>
      </EmptyState>
    );
  }
  return (
    <Panel id="tuning-autopilot-history" className="tuning-autopilot-panel">
      <h2 style={{ marginTop: 0 }}>Iteration history</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Scores come only from overshoot, settle time, error, and oscillation you logged.
      </p>
      <ul className="tuning-autopilot-list">
        {[...view.iterations].reverse().map((iteration) => (
          <li key={iteration.id} className="app-card soft-panel tuning-autopilot-card">
            <div>
              <span className={`app-badge ${scoreTone(iteration.score)}`}>
                #{iteration.iterationIndex} · {formatTuningScorePct(iteration.score, true, true)}
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
              onClick={() =>
                mutate({ action: "delete-iteration", iterationId: iteration.id, sessionId: view.selectedSessionId })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
