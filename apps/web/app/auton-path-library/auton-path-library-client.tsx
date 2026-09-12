"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  AUTON_PATH_RUN_OUTCOMES,
  AUTON_PATH_START_POSITIONS,
  autonPathRunOutcomeLabel,
  autonPathStartPositionLabel,
} from "../../lib/auton-path-library";
import type { AutonPathLibraryView } from "../../lib/auton-path-library/compute-auton-path-library";
import type { AutonPathRunOutcome, AutonPathStartPosition, AutonPathWithStats } from "../../lib/auton-path-library/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

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

function isAutonPathLibraryView(value: unknown): value is AutonPathLibraryView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function autonPathCacheOrg(data: AutonPathLibraryView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistAutonPathSnapshot(
  orgHint: string,
  seasonHint: string,
  data: AutonPathLibraryView,
): Promise<void> {
  const cacheOrg = autonPathCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("auton-path-library", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("auton-path-library", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Auton paths already painted; IndexedDB is best-effort.
  }
}

function AutonPathRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related robot tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "tuning-log", orgId)}>
        Tuning log
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "code-perf", orgId)}>
        Code vs match
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "bringup", orgId)}>
        Bring-up
      </Button>
    </nav>
  );
}

function AutonPathNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a path",
      detail: "Name each starting position so runs have somewhere to land.",
      href: "#auton-path-form",
      primary: true,
    },
    {
      id: "tuning",
      label: "Open Tuning log",
      detail: "Constants that made a path work belong next to the success rate.",
      href: hubHref("/build", "tuning-log", orgId),
      primary: false,
    },
    {
      id: "code",
      label: "Open Code vs match",
      detail: "Which deploy actually ran this path.",
      href: hubHref("/build", "code-perf", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function AutonPathLibraryClient() {
  const [view, setView] = useState<AutonPathLibraryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<AutonPathLibraryView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<AutonPathLibraryView>(
        "auton-path-library",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isAutonPathLibraryView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadStatus(null);
    setLoadError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/auton-path-library${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setLoadStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isAutonPathLibraryView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Auton paths. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setLoadStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistAutonPathSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Auton paths. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isAutonPathLibraryView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistAutonPathSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Auton paths"}
        </>
      }
      title="Auton paths"
      description="Track named autonomous paths and log every run to see real success rates per path — not a single subjective flag."
    >
      <AutonPathRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Auton paths" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Auton paths"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Auton paths" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Auton paths" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <AutonPathNextActions orgId={view.orgId} />
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
          style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line, #2a2a2a)", paddingTop: 8 }}
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
            <Button variant="primary" type="submit" disabled={busy || !occurredOn}>
              Save run
            </Button>
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
      id="auton-path-form"
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
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add path
        </Button>
      </div>
    </Panel>
  );
}
