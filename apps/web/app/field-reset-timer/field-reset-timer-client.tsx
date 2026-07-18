"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import type { FieldResetTimerView } from "../../lib/field-reset-timer/compute-field-reset-timer";
import type { FieldResetTimerTier } from "../../lib/field-reset-timer/types";

function tierTone(tier: FieldResetTimerTier): string {
  if (tier === "tight") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<FieldResetTimerView, { status: "live" }>;

export default function FieldResetTimerClient() {
  const [view, setView] = useState<FieldResetTimerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/field-reset-timer${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as FieldResetTimerView | { error?: string };
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
        const response = await fetch("/api/field-reset-timer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as FieldResetTimerView | { error?: string };
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

  useEffect(() => {
    const firstSession = view?.status === "live" ? view.sessions[0] : undefined;
    if (firstSession && !selectedSessionId) {
      setSelectedSessionId(firstSession.id);
    }
  }, [view, selectedSessionId]);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Field Reset Timer"}
          </>
        }
        title="Field Reset Timer"
        description="Time field-reset and cycle speed during driver practice — see whether reset drills are actually getting faster and more consistent."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
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
          title="Could not load Field Reset Timer"
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
          <ReadinessPanel view={view} />
          <NewSessionForm busy={busy} mutate={mutate} />
          <SessionList
            view={view}
            busy={busy}
            mutate={mutate}
            selectedSessionId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
          {selectedSessionId ? (
            <CycleLog
              view={view}
              sessionId={selectedSessionId}
              busy={busy}
              mutate={mutate}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  return (
    <Panel aria-label="Reset-drill readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Reset-drill readiness</h2>
          <small className="app-muted">
            {readiness.sessionsLogged} session(s) · {readiness.totalCycles} cycle(s) logged
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>
            {readiness.avgResetSeconds != null ? `${readiness.avgResetSeconds}s` : "—"}
          </strong>
          <span className="app-muted">Avg reset</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>
            {readiness.bestResetSeconds != null ? `${readiness.bestResetSeconds}s` : "—"}
          </strong>
          <span className="app-muted">Best reset</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.4rem", display: "block" }}>{pct(readiness.consistency)}</strong>
          <span className="app-muted">Consistency</span>
        </div>
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
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
  const empty = useMemo(() => ({ label: "", occurredOn: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.label.trim() || !form.occurredOn) return;
        mutate({
          action: "create-session",
          label: form.label,
          occurredOn: form.occurredOn,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Start a practice session</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input value={form.label} onChange={set("label")} placeholder="Tuesday driver practice" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.label.trim() || !form.occurredOn}>
          Create session
        </button>
      </div>
    </Panel>
  );
}

function SessionList({
  view,
  busy,
  mutate,
  selectedSessionId,
  onSelect,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  selectedSessionId: string | null;
  onSelect: (id: string) => void;
}) {
  if (view.sessions.length === 0) {
    return (
      <EmptyState
        badge="No sessions yet"
        badgeTone="setup"
        title="Create your first practice session"
        description="Start a session, then log reset cycles as your drive team runs them."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.sessions.map((sessionItem) => {
          const summary = view.sessionSummaries.find((s) => s.sessionId === sessionItem.id);
          return (
            <li
              key={sessionItem.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "flex-start",
                padding: 8,
                borderRadius: 8,
                background: sessionItem.id === selectedSessionId ? "rgba(120,120,255,0.08)" : "transparent",
              }}
            >
              <button
                type="button"
                className="text-button"
                style={{ textAlign: "left" }}
                onClick={() => onSelect(sessionItem.id)}
              >
                <strong>{sessionItem.label}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {sessionItem.occurredOn} · {sessionItem.cycleCount} cycle(s)
                  {summary ? ` · avg ${summary.avgResetSeconds}s · best ${summary.bestResetSeconds}s` : ""}
                </small>
                {sessionItem.notes ? <small className="app-muted">{sessionItem.notes}</small> : null}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${sessionItem.label}" and its logged cycles?`)) {
                    mutate({ action: "delete-session", sessionId: sessionItem.id });
                    if (sessionItem.id === selectedSessionId) onSelect("");
                  }
                }}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function CycleLog({
  view,
  sessionId,
  busy,
  mutate,
}: {
  view: LiveView;
  sessionId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const sessionCycles = view.cycles.filter((c) => c.sessionId === sessionId);
  const sessionLabel = view.sessions.find((s) => s.id === sessionId)?.label ?? "Session";
  const nextCycleNumber = sessionCycles.length + 1;
  const empty = useMemo(() => ({ resetSeconds: "", cycleSeconds: "", note: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>{sessionLabel} · reset cycles</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const resetSeconds = Number(form.resetSeconds);
          if (!Number.isFinite(resetSeconds) || resetSeconds < 0) return;
          mutate({
            action: "log-cycle",
            sessionId,
            cycleNumber: nextCycleNumber,
            resetSeconds,
            cycleSeconds: form.cycleSeconds ? Number(form.cycleSeconds) : undefined,
            note: form.note || undefined,
          });
          setForm(empty);
        }}
        style={{ display: "grid", gap: 10, marginBottom: 16 }}
      >
        <FormGrid min={140}>
          <FormRow label={`Cycle #${nextCycleNumber} reset (s)`}>
            <input type="number" min={0} step={0.1} value={form.resetSeconds} onChange={set("resetSeconds")} required />
          </FormRow>
          <FormRow label="Full cycle (s, optional)">
            <input type="number" min={0} step={0.1} value={form.cycleSeconds} onChange={set("cycleSeconds")} />
          </FormRow>
          <FormRow label="Note (optional)">
            <input value={form.note} onChange={set("note")} placeholder="Dropped a game piece" />
          </FormRow>
        </FormGrid>
        <div>
          <button type="submit" className="app-button" disabled={busy || !form.resetSeconds}>
            Log cycle
          </button>
        </div>
      </form>

      {sessionCycles.length === 0 ? (
        <EmptyState
          badge="No cycles yet"
          badgeTone="setup"
          title="Log your first reset cycle"
          description="Time each field reset as your drive team runs it to build the session's trend."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {sessionCycles.map((cycle) => (
            <li key={cycle.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>Cycle #{cycle.cycleNumber}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  Reset {cycle.resetSeconds}s{cycle.cycleSeconds != null ? ` · full cycle ${cycle.cycleSeconds}s` : ""}
                  {cycle.note ? ` · ${cycle.note}` : ""}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "delete-cycle", cycleId: cycle.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
