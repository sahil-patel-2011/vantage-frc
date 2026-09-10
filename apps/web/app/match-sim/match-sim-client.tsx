"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { phaseLabel } from "../../lib/match-sim";
import type { MatchSimView } from "../../lib/match-sim/compute-match-sim";
import type { AllianceColor, MatchSimRun } from "../../lib/match-sim/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isMatchSimView(value: unknown): value is MatchSimView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistMatchSimSnapshot(orgHint: string, data: MatchSimView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("match-sim", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("match-sim", "_", data);
  } catch {
    // Live simulator already painted; IndexedDB is best-effort.
  }
}

function allianceLabel(color: AllianceColor): string {
  return color === "red" ? "Red" : "Blue";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MatchSimView, { status: "live" }>;

export default function MatchSimClient() {
  const [view, setView] = useState<MatchSimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<MatchSimView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((runId?: string) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MatchSimView>("match-sim", urlOrg || "_");
        if (!viewRef.current && cached?.data && isMatchSimView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setErrorStatus(null);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (runId) query.set("runId", runId);
      try {
        const response = await fetch(`/api/match-sim${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as MatchSimView | { error?: string };
        if (!response.ok || !isMatchSimView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Match Simulator. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setErrorStatus(response.status);
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistMatchSimSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Match Simulator. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
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
        const response = await fetch("/api/match-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as MatchSimView | { error?: string };
        if (!response.ok || !isMatchSimView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistMatchSimSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Match Simulator"}
          </>
        }
        title="Match Simulator"
        description="Deterministic full-field score timeline from real, synced EPA capability data — plus the single highest-leverage lever to pull. Nothing here is guessed."
      />
      <OfflineBanner feature="Match Simulator" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SimulateForm busy={busy} mutate={mutate} />
          {view.active ? <ActiveRunResult view={view} run={view.active} /> : null}
          <SavedRuns view={view} busy={busy} load={load} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SimulateForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ label: "", eventKey: "", matchKey: "", redTeamKeys: "", blueTeamKeys: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const parseKeys = (raw: string): string[] =>
    raw
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => (/^\d+$/.test(token) ? `frc${token}` : token.toLowerCase()));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        const redTeamKeys = parseKeys(form.redTeamKeys);
        const blueTeamKeys = parseKeys(form.blueTeamKeys);
        if (redTeamKeys.length === 0 || blueTeamKeys.length === 0) return;
        mutate({
          action: "simulate",
          label: form.label || undefined,
          eventKey: form.eventKey || undefined,
          matchKey: form.matchKey || undefined,
          redTeamKeys,
          blueTeamKeys,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Run a simulation</h2>
      <FormGrid min={160}>
        <FormRow label="Red alliance (team numbers, comma-separated)">
          <input value={form.redTeamKeys} onChange={set("redTeamKeys")} placeholder="254, 1114, 971" required />
        </FormRow>
        <FormRow label="Blue alliance (team numbers, comma-separated)">
          <input value={form.blueTeamKeys} onChange={set("blueTeamKeys")} placeholder="118, 2056, 33" required />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026casj_qm12" />
        </FormRow>
        <FormRow label="Label (optional)">
          <input value={form.label} onChange={set("label")} placeholder="Quals 12" />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.redTeamKeys.trim() || !form.blueTeamKeys.trim()}>
          Simulate match
        </Button>
      </div>
    </Panel>
  );
}

function ActiveRunResult({ view, run }: { view: LiveView; run: MatchSimRun }) {
  const { result } = run;
  const maxScore = Math.max(result.red.total, result.blue.total, 1);
  return (
    <Panel aria-label="Simulation result">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className={`app-badge ${result.favored === "even" ? "setup" : "good"}`}>
            {result.favored === "even" ? "TOSS-UP" : `${allianceLabel(result.favored)} FAVORED`}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>{run.label}</h2>
          <small className="app-muted">
            {run.eventKey ?? "No event"} {run.matchKey ? `· ${run.matchKey}` : ""} · margin{" "}
            {result.finalMargin > 0 ? `Red +${result.finalMargin}` : result.finalMargin < 0 ? `Blue +${Math.abs(result.finalMargin)}` : "Even"}
          </small>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, marginTop: 16 }}>
        <AllianceCard alliance={result.red} maxScore={maxScore} />
        <AllianceCard alliance={result.blue} maxScore={maxScore} />
      </div>

      <div style={{ marginTop: 16 }}>
        <strong className="app-muted">Predicted score timeline</strong>
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 6 }}>
          {result.timeline.map((point) => (
            <li key={point.tSeconds} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, alignItems: "center" }}>
              <span className="app-muted">{point.label}</span>
              <span>Red {point.redScore}</span>
              <span>Blue {point.blueScore}</span>
            </li>
          ))}
        </ul>
      </div>

      {result.lever ? (
        <div style={{ marginTop: 16 }}>
          <strong className="app-muted">Highest-leverage lever</strong>
          <p style={{ margin: "4px 0 0" }}>
            <strong>{allianceLabel(result.lever.alliance)}</strong> · {phaseLabel(result.lever.phase)}
            {result.lever.teamNumber ? ` · Team ${result.lever.teamNumber}` : ""} — trailing by{" "}
            {result.lever.phaseGap} pts (est. {result.lever.marginSwing} pt margin swing)
          </p>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>{result.lever.rationale}</p>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 16 }}>No leverage lever — alliances are tied on every synced phase.</p>
      )}

      {view.active === run && (result.red.dataCompleteness < 1 || result.blue.dataCompleteness < 1) ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          Some teams have no synced EPA yet — they contribute 0 above rather than a guess (Red{" "}
          {pct(result.red.dataCompleteness)} covered, Blue {pct(result.blue.dataCompleteness)} covered).
        </p>
      ) : null}
    </Panel>
  );
}

function AllianceCard({ alliance, maxScore }: { alliance: MatchSimRun["result"]["red"]; maxScore: number }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 6px" }}>{allianceLabel(alliance.color)} alliance</h3>
      <span className="mini-probability" aria-hidden="true" style={{ display: "block", marginBottom: 6 }}>
        <i style={{ width: `${Math.max(2, (alliance.total / maxScore) * 100)}%` }} />
      </span>
      <strong style={{ fontSize: "1.4rem" }}>{alliance.total} pts</strong>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
        <li className="app-muted">Auto {alliance.auto} · Teleop {alliance.teleop} · Endgame {alliance.endgame}</li>
        {alliance.teams.map((t) => (
          <li key={t.teamKey} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{t.teamNumber ?? t.teamKey}</span>
            <small className="app-muted">
              {t.hasData ? `${t.epaTotal ?? 0} EPA (${t.source ?? "reference"})` : "No synced EPA"}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SavedRuns({
  view,
  busy,
  load,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  load: (runId?: string) => void;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.runs.length === 0) {
    return (
      <EmptyState
        badge="No simulations yet"
        badgeTone="setup"
        title="Run your first match simulation"
        description="Enter both alliances above to project a score timeline from synced EPA data."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Saved simulations</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.runs.map((run: MatchSimRun) => (
          <li key={run.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <button
              type="button"
              className="text-button"
              style={{ textAlign: "left" }}
              onClick={() => load(run.id)}
            >
              <strong>{run.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                Red {run.redTeamKeys.join(", ")} vs Blue {run.blueTeamKeys.join(", ")} · margin{" "}
                {run.result.finalMargin > 0 ? `Red +${run.result.finalMargin}` : run.result.finalMargin < 0 ? `Blue +${Math.abs(run.result.finalMargin)}` : "Even"}
              </small>
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${run.label}"?`)) {
                  mutate({ action: "delete-run", runId: run.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
