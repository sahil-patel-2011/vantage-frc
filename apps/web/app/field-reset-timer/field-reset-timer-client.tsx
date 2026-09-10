"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import type { FieldResetTimerView } from "../../lib/field-reset-timer/compute-field-reset-timer";
import type { FieldResetTimerTier } from "../../lib/field-reset-timer/types";
import {
  FIELD_RESET_TIMER_RELATED_INCLUDE,
  classifyFieldResetTimerShell,
  formatFieldResetTimerMetric,
  fieldResetTimerNextActions,
  fieldResetTimerRelatedLinks,
  fieldResetTimerSetupSteps,
  fieldResetTimerShellCopy,
  shouldShowFieldResetTimerSummaryTiles,
  type FieldResetTimerNextAction,
  type FieldResetTimerShellKind,
} from "../../lib/field-reset-timer/field-reset-timer-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./field-reset-timer.css";

function tierTone(tier: FieldResetTimerTier): BadgeTone {
  if (tier === "tight") return "good";
  if (tier === "developing") return "setup";
  return "neutral";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<FieldResetTimerView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = fieldResetTimerRelatedLinks(orgId, {
    include: [...FIELD_RESET_TIMER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related frt-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: FieldResetTimerNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions frt-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TimerShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: FieldResetTimerShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = fieldResetTimerNextActions({ orgId, shell });
  const copy = fieldResetTimerShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "field-reset-timer", orgId);
  const steps = shell === "setup" ? fieldResetTimerSetupSteps(orgId) : [];

  return (
    <main className="module-page frt-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Field Reset Timer"}
          </>
        }
        title="Field Reset Timer"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Field Reset Timer">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={hubHref("/team", "practice", orgId)}>Open Practice</Button>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="frt-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="frt-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted frt-tip">{step.detail}</p>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function FieldResetTimerClient() {
  const [view, setView] = useState<FieldResetTimerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sessionCount = view?.status === "live" ? view.sessions.length : 0;
  const cycleCount = view?.status === "live" ? view.cycles.length : 0;

  const shell = classifyFieldResetTimerShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    sessionCount,
  });
  const shellCopy = fieldResetTimerShellCopy(shell);
  const nextActions = fieldResetTimerNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    sessionCount,
    cycleCount,
  });
  const teamHref = hubWorkbenchHref("team", "field-reset-timer", orgId);
  const showTiles = shouldShowFieldResetTimerSummaryTiles(sessionCount, cycleCount);
  const loaded = view?.status === "live";

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

  if (shell === "loading") {
    return <TimerShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <TimerShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <TimerShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page frt-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Field Reset Timer"}
          </>
        }
        title="Field Reset Timer"
        description="Time field-reset and cycle speed during driver practice — real sessions only."
      >
        <div className="frt-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted frt-filter">
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="frt-panel" aria-label="Reset-drill readiness">
          <header className="frt-readiness-header">
            <div>
              <Badge tone={tierTone(view.readiness.tier)}>{view.readiness.tier.toUpperCase()}</Badge>
              <h2>Reset-drill readiness</h2>
              <small className="app-muted">
                {formatFieldResetTimerMetric(view.readiness.sessionsLogged, loaded)} session(s) ·{" "}
                {formatFieldResetTimerMetric(view.readiness.totalCycles, loaded)} cycle(s) logged
              </small>
            </div>
            <strong className="frt-score">{pct(view.readiness.score)}</strong>
          </header>
          <div className="frt-stats">
            <StatTile
              label="Avg reset"
              value={view.readiness.avgResetSeconds != null ? view.readiness.avgResetSeconds : "—"}
              unit={view.readiness.avgResetSeconds != null ? "s" : undefined}
            />
            <StatTile
              label="Best reset"
              value={view.readiness.bestResetSeconds != null ? view.readiness.bestResetSeconds : "—"}
              unit={view.readiness.bestResetSeconds != null ? "s" : undefined}
            />
            <StatTile label="Consistency" value={pct(view.readiness.consistency)} />
          </div>
          {view.readiness.recommendations.length > 0 ? (
            <div>
              <strong className="app-muted">Next steps</strong>
              <ul className="frt-recs">
                {view.readiness.recommendations.map((rec) => (
                  <li key={rec}>{rec}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <NewSessionForm busy={busy} mutate={mutate} />
      <SessionList
        view={view}
        busy={busy}
        mutate={mutate}
        selectedSessionId={selectedSessionId}
        onSelect={setSelectedSessionId}
      />
      {selectedSessionId ? (
        <CycleLog view={view} sessionId={selectedSessionId} busy={busy} mutate={mutate} />
      ) : null}
      <NextActionsPanel actions={nextActions} />
    </main>
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
      id="field-reset-new-session"
      className="frt-panel"
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
    >
      <h2>Start a practice session</h2>
      <p className="app-muted frt-tip">Real practice dates only.</p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.label.trim() || !form.occurredOn}>
          Create session
        </Button>
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
        soft
        badge="No sessions yet"
        badgeTone="setup"
        title="Create your first practice session"
        description="Start a session, then log reset cycles as your drive team runs them."
      />
    );
  }
  return (
    <Panel id="field-reset-sessions" className="frt-panel">
      <h2>Sessions</h2>
      <ul className="frt-list">
        {view.sessions.map((sessionItem) => {
          const summary = view.sessionSummaries.find((s) => s.sessionId === sessionItem.id);
          return (
            <li
              key={sessionItem.id}
              className={sessionItem.id === selectedSessionId ? "frt-session selected" : "frt-session"}
            >
              <button type="button" className="text-button frt-session-btn" onClick={() => onSelect(sessionItem.id)}>
                <strong>{sessionItem.label}</strong>
                <small className="app-muted frt-block">
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
    <Panel id="field-reset-cycles" className="frt-panel">
      <h2>
        {sessionLabel} · reset cycles
      </h2>
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
        className="frt-cycle-form"
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
          <Button variant="primary" type="submit" disabled={busy || !form.resetSeconds}>
            Log cycle
          </Button>
        </div>
      </form>

      {sessionCycles.length === 0 ? (
        <EmptyState
          soft
          badge="No cycles yet"
          badgeTone="setup"
          title="Log your first reset cycle"
          description="Time each field reset as your drive team runs it."
        />
      ) : (
        <ul className="frt-list">
          {sessionCycles.map((cycle) => (
            <li key={cycle.id} className="frt-session">
              <div>
                <strong>Cycle #{cycle.cycleNumber}</strong>
                <small className="app-muted frt-block">
                  Reset {cycle.resetSeconds}s
                  {cycle.cycleSeconds != null ? ` · full cycle ${cycle.cycleSeconds}s` : ""}
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
