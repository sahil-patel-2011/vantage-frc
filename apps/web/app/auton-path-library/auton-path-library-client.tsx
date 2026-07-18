"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  AUTON_PATH_RUN_OUTCOMES,
  AUTON_PATH_START_POSITIONS,
  autonPathRunOutcomeLabel,
  autonPathStartPositionLabel,
} from "../../lib/auton-path-library";
import type { AutonPathLibraryView } from "../../lib/auton-path-library/compute-auton-path-library";
import type { AutonPathRunOutcome, AutonPathStartPosition, AutonPathWithStats } from "../../lib/auton-path-library/types";

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function successTone(rate: number | null): string {
  if (rate == null) return "demo";
  if (rate >= 0.7) return "good";
  if (rate >= 0.4) return "setup";
  return "demo";
}

type LiveView = Extract<AutonPathLibraryView, { status: "live" }>;

export default function AutonPathLibraryClient() {
  const [view, setView] = useState<AutonPathLibraryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

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
    void fetch(`/api/auton-path-library${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AutonPathLibraryView | { error?: string };
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
        const response = await fetch("/api/auton-path-library", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as AutonPathLibraryView | { error?: string };
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
            {" / Autonomous Path Library"}
          </>
        }
        title="Autonomous Path Library"
        description="Track named autonomous paths and log every run to see real success rates per path — not a single subjective flag."
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
          title="Could not load the Autonomous Path Library"
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
          <SummaryTiles view={view} />
          <CreatePathForm busy={busy} mutate={mutate} />
          {view.summary.totalPaths > 0 ? (
            <PathList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No paths yet"
              badgeTone="setup"
              title="Add your first autonomous path"
              description="Name each starting position/route so you can log runs and see success rates build up over the season."
            />
          )}
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const bestPath = summary.bestPathId ? view.paths.find((p) => p.id === summary.bestPathId) : null;
  const tiles = [
    { label: "Paths", value: String(summary.totalPaths) },
    { label: "Active paths", value: String(summary.activePaths) },
    { label: "Runs logged", value: String(summary.totalRuns) },
    { label: "Overall success rate", value: pct(summary.overallSuccessRate) },
    { label: "Best path", value: bestPath ? bestPath.name : "—" },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PathList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Paths</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.paths.map((path) => (
          <PathRow key={path.id} path={path} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function PathRow({
  path,
  busy,
  mutate,
}: {
  path: AutonPathWithStats;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [logging, setLogging] = useState(false);
  const [outcome, setOutcome] = useState<AutonPathRunOutcome>("success");
  const [occurredOn, setOccurredOn] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [matchLabel, setMatchLabel] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <li className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <strong>{path.name}</strong>
          {!path.active ? <span className="app-badge demo" style={{ marginLeft: 8 }}>Inactive</span> : null}
          <small className="app-muted" style={{ display: "block" }}>
            {autonPathStartPositionLabel(path.startPosition)} start · {path.gamePieces} piece(s)
            {path.description ? ` · ${path.description}` : ""}
          </small>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`app-badge ${successTone(path.stats.successRate)}`}>
            {pct(path.stats.successRate)} ({path.stats.totalRuns} run{path.stats.totalRuns === 1 ? "" : "s"})
          </span>
          <button type="button" className="text-button" disabled={busy} onClick={() => setLogging((v) => !v)}>
            {logging ? "Cancel" : "Log run"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => mutate({ action: "set-path-active", pathId: path.id, active: !path.active })}
          >
            {path.active ? "Deactivate" : "Activate"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${path.name}" and all its logged runs?`)) {
                mutate({ action: "delete-path", pathId: path.id });
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {logging ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!occurredOn) return;
            mutate({
              action: "log-run",
              pathId: path.id,
              outcome,
              occurredOn,
              eventLabel: eventLabel || undefined,
              matchLabel: matchLabel || undefined,
              notes: notes || undefined,
            });
            setLogging(false);
            setOutcome("success");
            setOccurredOn("");
            setEventLabel("");
            setMatchLabel("");
            setNotes("");
          }}
          style={{ display: "grid", gap: 8, borderTop: "1px solid var(--app-border, #2a2a2a)", paddingTop: 8 }}
        >
          <FormGrid min={140}>
            <FormRow label="Outcome">
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as AutonPathRunOutcome)}>
                {AUTON_PATH_RUN_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {autonPathRunOutcomeLabel(o)}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Date">
              <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
            </FormRow>
            <FormRow label="Event (optional)">
              <input value={eventLabel} onChange={(e) => setEventLabel(e.target.value)} placeholder="Week 1" />
            </FormRow>
            <FormRow label="Match (optional)">
              <input value={matchLabel} onChange={(e) => setMatchLabel(e.target.value)} placeholder="Q12" />
            </FormRow>
          </FormGrid>
          <FormRow label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </FormRow>
          <div>
            <button type="submit" className="app-button" disabled={busy || !occurredOn}>
              Save run
            </button>
          </div>
        </form>
      ) : null}

      {path.stats.totalRuns > 0 ? (
        <small className="app-muted">
          {path.stats.successRuns} success · {path.stats.partialRuns} partial · {path.stats.failRuns} fail
          {path.stats.lastRunOn ? ` · last run ${path.stats.lastRunOn}` : ""}
        </small>
      ) : (
        <small className="app-muted">No runs logged yet.</small>
      )}
    </li>
  );
}

function CreatePathForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      name: "",
      startPosition: "left" as AutonPathStartPosition,
      gamePieces: "",
      description: "",
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
        if (!form.name.trim()) return;
        mutate({
          action: "create-path",
          name: form.name,
          startPosition: form.startPosition,
          gamePieces: Number(form.gamePieces) || 0,
          description: form.description || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add path</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Left 2-piece" required />
        </FormRow>
        <FormRow label="Start position">
          <select value={form.startPosition} onChange={set("startPosition")}>
            {AUTON_PATH_START_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {autonPathStartPositionLabel(position)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Game pieces">
          <input type="number" min={0} value={form.gamePieces} onChange={set("gamePieces")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add path
        </button>
      </div>
    </Panel>
  );
}
