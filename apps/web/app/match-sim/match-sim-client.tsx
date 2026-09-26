"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { flipMatchSimResult, matchSimHasNoData, phaseLabel } from "../../lib/match-sim";
import type { MatchSimView } from "../../lib/match-sim/compute-match-sim";
import { eventKeyOfMatch } from "../../lib/match-sim/upcoming";
import { UpcomingMatchPicker } from "./upcoming-match-picker";
import type { AllianceColor, MatchSimRun } from "../../lib/match-sim/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";
import { describeMatchKey } from "../../lib/scouting/scout-target";
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

/** "frc1678" → "1678". */
function teamNumber(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

/**
 * One row per matchup: running the same six robots again saved another copy, so the list read
 * "Q33, Q33, Q33". The newest copy of each is kept.
 */
function latestDistinctRuns(runs: MatchSimRun[]): MatchSimRun[] {
  const seen = new Set<string>();
  const newestFirst = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = new Set<string>();
  for (const run of newestFirst) {
    const key = [run.eventKey ?? "", run.matchKey ?? "", [...run.redTeamKeys].sort().join(","), [...run.blueTeamKeys].sort().join(",")].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.add(run.id);
  }
  return runs.filter((run) => kept.has(run.id));
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
  // A match picked from the list shows its result right under the list, scrolled to —
  // on a phone it would otherwise land below the typed form, off screen.
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [revealRun, setRevealRun] = useState(false);
  const activeRunId = view && "active" in view ? (view.active?.id ?? null) : null;
  useEffect(() => {
    if (!revealRun || !activeRunId) return;
    resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setRevealRun(false);
  }, [revealRun, activeRunId]);
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
            setError("Could not refresh Predict. Showing the last copy on this device.");
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
          setError("Could not refresh Predict. Showing the last copy on this device.");
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

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href="/competition">Competition</a>
              {" / Predict"}
            </>
          }
          title="Predict"
          description="Who is likely to win any match, why, and the one phase that would swing it. From your scouting and this event's ratings; nothing is guessed."
        />
        <OfflineBanner feature="Predict" fromCache={fromCache} cachedAt={cachedAt} />
        {copy ? (
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
        ) : (
          <EmptyState title="Loading…" description="Checking your team." aria-busy />
        )}
      </main>
    );
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Predict"}
          </>
        }
        title="Predict"
        description="Who is likely to win any match, why, and the one phase that would swing it. From your scouting and this event's ratings; nothing is guessed."
      />
      <OfflineBanner feature="Predict" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {view.status === "setup_required" ? (
        <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <UpcomingMatchPicker
            orgId={orgId}
            busy={busy}
            onPick={(pick) => {
              setRevealRun(true);
              mutate({
                action: "simulate",
                label: pick.label,
                eventKey: eventKeyOfMatch(pick.matchKey) ?? undefined,
                matchKey: pick.matchKey,
                redTeamKeys: pick.red,
                blueTeamKeys: pick.blue,
              });
            }}
          />
          {view.active ? (
            <div ref={resultRef} style={{ scrollMarginTop: 72 }}>
              <ActiveRunResult key={view.active.id} view={view} run={view.active} />
            </div>
          ) : null}
          <SimulateForm
            busy={busy}
            mutate={mutate}
            eventKey={view.eventKey}
            eventName={view.eventName}
          />
          <SavedRuns view={view} busy={busy} load={load} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SimulateForm({
  busy,
  mutate,
  eventKey,
  eventName,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  eventKey: string | null;
  eventName: string | null;
}) {
  const activeEventKey = eventKey?.trim() ?? "";
  const empty = useMemo(() => {
    const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
    return {
      label: "",
      eventKey: params?.get("eventKey")?.trim() || activeEventKey,
      matchKey: params?.get("matchKey") ?? "",
      redTeamKeys: params?.get("red") ?? "",
      blueTeamKeys: params?.get("blue") ?? "",
    };
  }, [activeEventKey]);
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
      {/* Any six robots, in plain fields: the match key, event key and label were developer inputs
          on the one form a strategist uses to try a lineup. They fold away. */}
      <h2 style={{ margin: 0 }}>Try any six robots</h2>
      <FormGrid min={160}>
        <FormRow label="Red robots">
          <input value={form.redTeamKeys} onChange={set("redTeamKeys")} placeholder="Three team numbers" inputMode="numeric" required />
        </FormRow>
        <FormRow label="Blue robots">
          <input value={form.blueTeamKeys} onChange={set("blueTeamKeys")} placeholder="Three team numbers" inputMode="numeric" required />
        </FormRow>
      </FormGrid>
      <details className="match-sim-more">
        <summary style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer" }}>
          More: another event, a match, a name
        </summary>
        <FormGrid min={160}>
          <FormRow label={form.eventKey.trim() ? "Event" : "Another event (optional)"}>
            {form.eventKey.trim() ? (
              <input
                readOnly
                aria-label="Event"
                value={
                  scoutEventLabel({
                    eventName: form.eventKey === activeEventKey ? eventName : null,
                    eventKey: form.eventKey,
                  }) ?? ""
                }
              />
            ) : (
              <input value={form.eventKey} onChange={set("eventKey")} placeholder="Event code from The Blue Alliance" />
            )}
          </FormRow>
          <FormRow label="Match (optional)">
            <input value={form.matchKey} onChange={set("matchKey")} placeholder="Match code, if it is on the schedule" />
          </FormRow>
          <FormRow label="Name it (optional)">
            <input value={form.label} onChange={set("label")} placeholder="What if we play defense" />
          </FormRow>
        </FormGrid>
      </details>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.redTeamKeys.trim() || !form.blueTeamKeys.trim()}>
          Predict
        </Button>
      </div>
    </Panel>
  );
}

function ActiveRunResult({ view, run }: { view: LiveView; run: MatchSimRun }) {
  const [flipped, setFlipped] = useState(false);
  const result = flipped ? flipMatchSimResult(run.result) : run.result;
  const maxScore = Math.max(result.red.total, result.blue.total, 1);
  const noData = matchSimHasNoData(result);
  const win = noData ? null : (result.winChance ?? null);
  return (
    <Panel aria-label="Simulation result">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className={`app-badge ${noData || result.favored === "even" ? "setup" : "good"}`}>
            {noData
              ? "NOT ENOUGH DATA"
              : result.favored === "even"
                ? "TOSS-UP"
                : `${allianceLabel(result.favored)} FAVORED`}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>{run.label}</h2>
          <small className="app-muted">
            {scoutEventLabel({
              eventName: run.eventKey && run.eventKey === view.eventKey ? view.eventName : null,
              eventKey: run.eventKey,
            }) ?? "No event"}
            {run.matchKey ? ` · ${describeMatchKey(run.matchKey)}` : ""} · margin{" "}
            {result.finalMargin > 0 ? `Red +${result.finalMargin}` : result.finalMargin < 0 ? `Blue +${Math.abs(result.finalMargin)}` : "Even"}
          </small>
        </div>
        <Button variant="secondary" type="button" style={{ minHeight: 44 }} onClick={() => setFlipped((value) => !value)}>
          Flip red / blue
        </Button>
      </header>

      {noData ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          {result.red.dataCompleteness === 0 && result.blue.dataCompleteness === 0 ? "Neither alliance has" : `${allianceLabel(result.red.dataCompleteness === 0 ? "red" : "blue")} has`}{" "}
          a single robot with a synced rating{run.eventKey ? ` at ${run.eventKey}` : " this season"}, so there is nothing to
          compare. Check the event, or sync ratings from Rankings.
        </p>
      ) : null}

      {win ? (
        <div className="match-sim-win" aria-label={`Win chance: red ${pct(win.red)}, blue ${pct(win.blue)}`}>
          <div className="match-sim-win-bar" aria-hidden="true">
            <i className="is-red" style={{ width: pct(win.red) }} />
            <i className="is-blue" style={{ width: pct(win.blue) }} />
          </div>
          <div className="match-sim-win-labels">
            <strong>Red {pct(win.red)}</strong>
            <small className="app-muted">chance to win, from ratings and this event&rsquo;s spread</small>
            <strong>Blue {pct(win.blue)}</strong>
          </div>
        </div>
      ) : null}

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
          <strong className="app-muted">What would swing it most</strong>
          <p style={{ margin: "4px 0 0" }}>
            <strong>{allianceLabel(result.lever.alliance)}</strong> · {phaseLabel(result.lever.phase)}
            {result.lever.teamNumber ? ` · Team ${result.lever.teamNumber}` : ""} — trailing by{" "}
            {result.lever.phaseGap} pts (est. {result.lever.marginSwing} pt margin swing)
          </p>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>{result.lever.rationale}</p>
        </div>
      ) : (
        <p className="app-muted" style={{ marginTop: 16 }}>The alliances are even in every phase, so no single phase swings it.</p>
      )}

      {view.active === run && (result.red.dataCompleteness < 1 || result.blue.dataCompleteness < 1) ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          Some teams have no synced rating yet — they contribute 0 above rather than a guess (Red{" "}
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
              {t.hasData ? `season rating ${t.epaTotal ?? 0}` : "No rating yet"}
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
        description="Enter both alliances above to project a score timeline from synced ratings."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Saved simulations</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {latestDistinctRuns(view.runs).map((run: MatchSimRun) => (
          <li key={run.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <button
              type="button"
              className="text-button"
              style={{ textAlign: "left" }}
              onClick={() => load(run.id)}
            >
              <strong>{run.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                Red {run.redTeamKeys.map(teamNumber).join(" · ")} vs Blue {run.blueTeamKeys.map(teamNumber).join(" · ")} · margin{" "}
                {run.result.finalMargin > 0 ? `Red +${run.result.finalMargin}` : run.result.finalMargin < 0 ? `Blue +${Math.abs(run.result.finalMargin)}` : "Even"}
              </small>
            </button>
            <button
              type="button"
              className="text-button"
              style={{ minHeight: 44, minWidth: 44, padding: "0 10px", flex: "0 0 auto" }}
              aria-label={`Delete the simulation ${run.label}`}
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
