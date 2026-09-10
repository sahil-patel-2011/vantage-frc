"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { countMetricLabel } from "../../lib/scout-assisted-count";
import {
  COUNT_METRIC_KEYS,
  type CountMetricKey,
  type ScoutAssistedCountView,
} from "../../lib/scout-assisted-count/compute-scout-assisted-count";
import {
  SCOUT_ASSISTED_COUNT_RELATED_INCLUDE,
  classifyScoutAssistedCountShell,
  formatScoutAssistedCountMetric,
  scoutAssistedCountNextActions,
  scoutAssistedCountRelatedLinks,
  scoutAssistedCountSetupSteps,
  scoutAssistedCountShellCopy,
  shouldShowScoutAssistedCountSummaryTiles,
  type ScoutAssistedCountNextAction,
  type ScoutAssistedCountShellKind,
} from "../../lib/scout-assisted-count/scout-assisted-count-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import "./scout-assisted-count.css";

type LiveView = Extract<ScoutAssistedCountView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutAssistedCountRelatedLinks(orgId, {
    include: [...SCOUT_ASSISTED_COUNT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sac-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: ScoutAssistedCountNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions sac-next-actions" aria-label="Next actions">
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

function CountShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutAssistedCountShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutAssistedCountNextActions({ orgId, shell });
  const copy = scoutAssistedCountShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "scout-assisted-count", orgId);
  const setup = shell === "setup" ? scoutAssistedCountSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page sac-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout-Assisted Count"}
          </>
        }
        title="Scout-Assisted Count"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Scout-Assisted Count">
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
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#scout-assisted-count-start">Start a session</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutAssistedCountClient() {
  const [view, setView] = useState<ScoutAssistedCountView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/scout-assisted-count${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as ScoutAssistedCountView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sessionCount = view?.status === "live" ? view.sessions.length : 0;
  const tapCount = view?.status === "live" ? view.summary.totalTaps : 0;
  const openSessions = view?.status === "live" ? view.summary.openSessions : 0;

  const shell = classifyScoutAssistedCountShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    sessionCount,
  });
  const shellCopy = scoutAssistedCountShellCopy(shell);
  const nextActions = scoutAssistedCountNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    sessionCount,
    openSessions,
  });
  const competitionHref = hubWorkbenchHref("competition", "scout-assisted-count", orgId);
  const showTiles = shouldShowScoutAssistedCountSummaryTiles(sessionCount, tapCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scout-assisted-count", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ScoutAssistedCountView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <CountShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <CountShell
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
      <CountShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page sac-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scout-Assisted Count"}
          </>
        }
        title="Scout-Assisted Count"
        description="Tap a counter during a match instead of typing — every tap is audited. Cross-check Scouting and Forms."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="sac-panel">
          <div className="sac-stats">
            <StatTile label="Sessions" value={formatScoutAssistedCountMetric(view.summary.totalSessions, loaded)} />
            <StatTile label="Open" value={formatScoutAssistedCountMetric(view.summary.openSessions, loaded)} />
            <StatTile label="Closed" value={formatScoutAssistedCountMetric(view.summary.closedSessions, loaded)} />
            <StatTile label="Total taps" value={formatScoutAssistedCountMetric(view.summary.totalTaps, loaded)} />
            <StatTile
              label="Avg taps / session"
              value={formatScoutAssistedCountMetric(view.summary.averageTapsPerSession, loaded)}
            />
          </div>
        </Panel>
      ) : null}

      <StartSessionForm busy={busy} mutate={mutate} />
      <Sessions view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function StartSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState("");
  const [metricKey, setMetricKey] = useState<CountMetricKey>("cycles");
  const [matchKey, setMatchKey] = useState("");
  const [teamKey, setTeamKey] = useState("");

  return (
    <Panel
      id="scout-assisted-count-start"
      as="form"
      className="sac-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!label.trim()) return;
        mutate({
          action: "start-session",
          label,
          metricKey,
          matchKey: matchKey || undefined,
          teamKey: teamKey || undefined,
        });
        setLabel("");
        setMatchKey("");
        setTeamKey("");
      }}
    >
      <h2>Start a counting session</h2>
      <p className="app-muted">Real match keys and audited taps.</p>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Opponent auto cycles"
            required
          />
        </FormRow>
        <FormRow label="Metric">
          <select value={metricKey} onChange={(event) => setMetricKey(event.target.value as CountMetricKey)}>
            {COUNT_METRIC_KEYS.map((key) => (
              <option key={key} value={key}>
                {countMetricLabel(key)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={matchKey} onChange={(event) => setMatchKey(event.target.value)} placeholder="2026casj_qm12" />
        </FormRow>
        <FormRow label="Team key (optional)">
          <input value={teamKey} onChange={(event) => setTeamKey(event.target.value)} placeholder="frc254" />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !label.trim()}>
          Start session
        </Button>
      </div>
    </Panel>
  );
}

function Sessions({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.sessions.length === 0) {
    return (
      <EmptyState
        soft
        badge="No sessions yet"
        badgeTone="setup"
        title="Start your first counting session"
        description="Tap during a match — the tally is audited."
      />
    );
  }
  return (
    <Panel id="scout-assisted-count-sessions" className="sac-panel">
      <h2>Sessions</h2>
      <ul className="sac-session-list">
        {view.sessions.map((s) => (
          <li key={s.id} className="app-card soft-panel sac-session-card">
            <div className="sac-session-header">
              <div>
                <strong>{s.label}</strong>
                <small className="app-muted sac-block">
                  {countMetricLabel(s.metricKey)}
                  {s.matchKey ? ` · ${s.matchKey}` : ""}
                  {s.teamKey ? ` · ${s.teamKey}` : ""}
                </small>
              </div>
              <Badge tone={s.status === "open" ? "good" : "neutral"}>{s.status.toUpperCase()}</Badge>
            </div>
            <div className="sac-tap-row">
              <strong className="sac-tap-count">{s.tapCount}</strong>
              {s.status === "open" ? (
                <>
                  <Button variant="primary" type="button" disabled={busy} aria-label={`Add tap to ${s.label}`} onClick={() => mutate({ action: "tap", sessionId: s.id, delta: 1 })}>
                    + Tap
                  </Button>
                  <Button variant="secondary" type="button" disabled={busy || s.tapCount === 0} aria-label={`Undo last tap on ${s.label}`} onClick={() => mutate({ action: "tap", sessionId: s.id, delta: -1 })}>
                    − Undo tap
                  </Button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    aria-label={`Close session ${s.label}`}
                    onClick={() => mutate({ action: "close-session", sessionId: s.id })}
                  >
                    Close session
                  </button>
                </>
              ) : (
                <small className="app-muted">
                  Closed {s.closedAt ? new Date(s.closedAt).toLocaleString() : ""}
                </small>
              )}
            </div>
            {s.taps.length > 0 ? (
              <details>
                <summary className="app-muted">Raw tap log ({s.taps.length})</summary>
                <ul className="sac-tap-log">
                  {s.taps.map((tap) => (
                    <li key={tap.id} className="app-muted sac-tap-log-row">
                      <span>{tap.delta > 0 ? `+${tap.delta}` : tap.delta}</span>
                      <span>{new Date(tap.tappedAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
