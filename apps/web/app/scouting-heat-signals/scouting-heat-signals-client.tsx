"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { HEAT_DIRECTIONS, directionLabel } from "../../lib/scouting-heat-signals";
import type { ScoutingHeatSignalsView } from "../../lib/scouting-heat-signals/compute-scouting-heat-signals";
import type { HeatDirection } from "../../lib/scouting-heat-signals/types";
import {
  SCOUTING_HEAT_SIGNALS_RELATED_INCLUDE,
  classifyScoutingHeatSignalsShell,
  formatScoutingHeatSignalsMetric,
  scoutingHeatSignalsNextActions,
  scoutingHeatSignalsRelatedLinks,
  scoutingHeatSignalsSetupSteps,
  scoutingHeatSignalsShellCopy,
  shouldShowScoutingHeatSignalsSummaryTiles,
  type ScoutingHeatSignalsNextAction,
  type ScoutingHeatSignalsShellKind,
} from "../../lib/scouting-heat-signals/scouting-heat-signals-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./scouting-heat-signals.css";

const directionToneMap: Record<HeatDirection, BadgeTone> = {
  up: "good",
  down: "danger",
  steady: "setup",
};

function directionTone(direction: HeatDirection): BadgeTone {
  return directionToneMap[direction] ?? "setup";
}

function directionArrow(direction: HeatDirection): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

type LiveView = Extract<ScoutingHeatSignalsView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutingHeatSignalsRelatedLinks(orgId, {
    include: [...SCOUTING_HEAT_SIGNALS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related shs-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: ScoutingHeatSignalsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions shs-next-actions" aria-label="Next actions">
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

function HeatShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutingHeatSignalsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutingHeatSignalsNextActions({ orgId, shell });
  const copy = scoutingHeatSignalsShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "scouting-heat-signals", orgId);
  const steps = shell === "setup" ? scoutingHeatSignalsSetupSteps(orgId) : [];

  return (
    <main className="module-page shs-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scouting Heat Signals"}
          </>
        }
        title="Scouting Heat Signals"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading scouting heat signals">
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
            <Button as="a" variant="primary" href="#scouting-heat-log">Log a heat signal</Button>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="shs-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="shs-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted shs-tip">{step.detail}</p>
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

export default function ScoutingHeatSignalsClient() {
  const [view, setView] = useState<ScoutingHeatSignalsView | null>(null);
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
    void fetch(`/api/scouting-heat-signals${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutingHeatSignalsView | { error?: string };
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
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const risingCount = view?.status === "live" ? view.summary.risingTeams : 0;

  const shell = classifyScoutingHeatSignalsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    entryCount,
  });
  const shellCopy = scoutingHeatSignalsShellCopy(shell);
  const nextActions = scoutingHeatSignalsNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    entryCount,
    risingCount,
  });
  const competitionHref = hubWorkbenchHref("competition", "scouting-heat-signals", orgId);
  const showTiles = shouldShowScoutingHeatSignalsSummaryTiles(entryCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scouting-heat-signals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ScoutingHeatSignalsView | { error?: string };
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
    return <HeatShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <HeatShell
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
      <HeatShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page shs-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Scouting Heat Signals"}
          </>
        }
        title="Scouting Heat Signals"
        description="Highlight teams trending up or down from what scouts have actually observed."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="shs-panel">
          <div className="shs-stats">
            <StatTile label="Teams tracked" value={formatScoutingHeatSignalsMetric(view.summary.totalTeams, loaded)} />
            <StatTile label="Observations" value={formatScoutingHeatSignalsMetric(view.summary.totalEntries, loaded)} />
            <StatTile label="Trending up" value={formatScoutingHeatSignalsMetric(view.summary.risingTeams, loaded)} />
            <StatTile label="Trending down" value={formatScoutingHeatSignalsMetric(view.summary.fallingTeams, loaded)} />
            <StatTile label="Steady" value={formatScoutingHeatSignalsMetric(view.summary.steadyTeams, loaded)} />
          </div>
        </Panel>
      ) : null}

      <LogEntryForm busy={busy} mutate={mutate} />
      <TeamHeatList view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function TeamHeatList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.teams.length === 0) {
    return (
      <EmptyState
        soft
        badge="No observations yet"
        badgeTone="setup"
        title="Log your first heat signal"
        description="Record a team as trending up or down after a match."
      />
    );
  }
  return (
    <Panel id="scouting-heat-list" className="shs-panel">
      <h2>Team heat signals</h2>
      <ul className="shs-team-list">
        {view.teams.map((team) => (
          <li key={team.teamKey} className="app-card soft-panel shs-team-card">
            <div className="shs-team-header">
              <div>
                <Badge tone={directionTone(team.direction)}>
                  {directionArrow(team.direction)} {directionLabel(team.direction)}
                </Badge>
                <strong className="shs-team-name">
                  {team.teamNumber ?? team.teamKey} {team.nickname ? `— ${team.nickname}` : ""}
                </strong>
                <small className="app-muted">
                  {team.entryCount} observation(s) · last {team.lastObservedOn}
                  {team.metricDelta != null
                    ? ` · metric delta ${team.metricDelta > 0 ? "+" : ""}${team.metricDelta}`
                    : ""}
                </small>
              </div>
              <small className="app-muted">
                {team.risingCount}↑ · {team.fallingCount}↓ · {team.steadyCount}→
              </small>
            </div>
            <ul className="shs-entry-list">
              {team.recentEntries.map((entry) => (
                <li key={entry.id} className="shs-entry-row">
                  <small className="app-muted">
                    {entry.observedOn} · {directionArrow(entry.direction)} {directionLabel(entry.direction)}
                    {entry.metricValue != null ? ` · ${entry.metricValue}` : ""}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </small>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => mutate({ action: "delete-entry", entryId: entry.id })}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      teamNumber: "",
      observedOn: "",
      direction: "up" as HeatDirection,
      metricValue: "",
      matchKey: "",
      note: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="scouting-heat-log"
      as="form"
      className="shs-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.teamNumber || !form.observedOn) return;
        mutate({
          action: "log-entry",
          teamNumber: Number(form.teamNumber),
          observedOn: form.observedOn,
          direction: form.direction,
          metricValue: form.metricValue === "" ? undefined : Number(form.metricValue),
          matchKey: form.matchKey || undefined,
          note: form.note || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Log a heat signal</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} required />
        </FormRow>
        <FormRow label="Observed on">
          <input type="date" value={form.observedOn} onChange={set("observedOn")} required />
        </FormRow>
        <FormRow label="Direction">
          <select value={form.direction} onChange={set("direction")}>
            {HEAT_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {directionLabel(direction)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Metric value (optional)">
          <input type="number" value={form.metricValue} onChange={set("metricValue")} />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026week1_qm12" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.note} onChange={set("note")} rows={2} />
      </FormRow>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !form.teamNumber || !form.observedOn}>
          Log signal
        </Button>
      </div>
    </Panel>
  );
}
