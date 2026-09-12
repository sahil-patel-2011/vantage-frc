"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { trainingWinnerLabel } from "../../lib/scout-training-mode";
import type { ScoutTrainingView } from "../../lib/scout-training-mode/compute-scout-training-mode";
import type { PracticeMatch, TrainingWinner } from "../../lib/scout-training-mode/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

const WINNER_OPTIONS: TrainingWinner[] = ["red", "blue", "tie"];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function accuracyTone(score: number): string {
  if (score >= 0.75) return "good";
  if (score >= 0.4) return "setup";
  return "demo";
}

type LiveView = Extract<ScoutTrainingView, { status: "live" }>;

function isScoutTrainingView(value: unknown): value is ScoutTrainingView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function scoutTrainingCacheOrg(data: ScoutTrainingView, orgHint: string): string {
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

async function persistScoutTrainingSnapshot(orgHint: string, data: ScoutTrainingView): Promise<void> {
  const cacheOrg = scoutTrainingCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scout-training-mode", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("scout-training-mode", "_", data);
  } catch {
    // Live Scout training already painted; IndexedDB is best-effort.
  }
}

function ScoutTrainingRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related scouting tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "data-quality-scorecard", orgId)}>
        Data quality
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/scouting/lineup", orgId)}>
        Coverage
      </Button>
    </nav>
  );
}

function ScoutTrainingNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "practice",
      label: "Practice a match",
      detail: "Call the winner and scores on a completed match before you scout live.",
      href: "#scout-training-practice",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match and pit entries are logged on the scouting board.",
      href: hubHref("/competition", "scouting", orgId),
      primary: false,
    },
    {
      id: "quality",
      label: "Open Data quality",
      detail: "Coverage and cross-scout checks sit beside this practice board.",
      href: hubHref("/competition", "data-quality-scorecard", orgId),
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

export default function ScoutTrainingModeClient() {
  const [view, setView] = useState<ScoutTrainingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutTrainingView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ScoutTrainingView>("scout-training-mode", orgHint || "_");
      if (!viewRef.current && cached?.data && isScoutTrainingView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(
        `/api/scout-training-mode${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isScoutTrainingView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Scout training mode. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistScoutTrainingSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Scout training mode. Showing the last copy on this device.");
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
        const response = await fetch("/api/scout-training-mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isScoutTrainingView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistScoutTrainingSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / Scout training mode"}
        </>
      }
      title="Scout training mode"
      description="Practice scouting on real, already-completed matches and see how close your call was — the fast way to onboard new scouts before they scout live."
    >
      <ScoutTrainingRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Scout training mode" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Training"}
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
          <OfflineBanner feature="Scout training mode" fromCache={fromCache} cachedAt={cachedAt} />
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
      <OfflineBanner feature="Scout training mode" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <ScoutTrainingNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <PracticeForm view={view} busy={busy} mutate={mutate} />
        <RecentAttempts view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Attempts", value: String(summary.totalAttempts) },
    { label: "Average accuracy", value: pct(summary.averageAccuracy) },
    { label: "Best attempt", value: pct(summary.bestAccuracy) },
    { label: "Correct winner calls", value: pct(summary.winnerCallAccuracy) },
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
      {summary.recentAccuracyTrend.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Recent trend</strong>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {summary.recentAccuracyTrend.map((score, index) => (
              <span key={index} className={`app-badge ${accuracyTone(score)}`}>
                {pct(score)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function matchLabel(match: PracticeMatch): string {
  return `${match.eventKey} · ${match.compLevel.toUpperCase()} ${match.matchNumber}`;
}

function PracticeForm({
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
      matchKey: view.practiceMatches[0]?.matchKey ?? "",
      predictedWinner: "red" as TrainingWinner,
      predictedRedScore: "",
      predictedBlueScore: "",
      durationSeconds: "",
      notes: "",
    }),
    [view.practiceMatches],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.practiceMatches.length === 0) {
    return (
      <EmptyState
        badge="No practice matches"
        badgeTone="setup"
        title="No historical matches available to practice on right now"
        description="Once more match data syncs, practice matches will appear here."
      />
    );
  }

  return (
    <Panel
      id="scout-training-practice"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.matchKey) return;
        mutate({
          action: "submit-attempt",
          matchKey: form.matchKey,
          predictedWinner: form.predictedWinner,
          predictedRedScore: Number(form.predictedRedScore) || 0,
          predictedBlueScore: Number(form.predictedBlueScore) || 0,
          durationSeconds: Number(form.durationSeconds) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Practice a match</h2>
      <FormGrid min={160}>
        <FormRow label="Historical match">
          <select value={form.matchKey} onChange={set("matchKey")} required>
            {view.practiceMatches.map((match) => (
              <option key={match.matchKey} value={match.matchKey}>
                {matchLabel(match)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Who won?">
          <select value={form.predictedWinner} onChange={set("predictedWinner")}>
            {WINNER_OPTIONS.map((winner) => (
              <option key={winner} value={winner}>
                {trainingWinnerLabel(winner)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Predicted red score">
          <input type="number" min={0} value={form.predictedRedScore} onChange={set("predictedRedScore")} />
        </FormRow>
        <FormRow label="Predicted blue score">
          <input type="number" min={0} value={form.predictedBlueScore} onChange={set("predictedBlueScore")} />
        </FormRow>
        <FormRow label="Time spent (seconds)">
          <input type="number" min={0} value={form.durationSeconds} onChange={set("durationSeconds")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.matchKey}>
          Submit prediction
        </Button>
      </div>
    </Panel>
  );
}

function RecentAttempts({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.attempts.length === 0) {
    return (
      <EmptyState
        badge="No attempts yet"
        badgeTone="setup"
        title="Practice your first match above"
        description="Submit a prediction on a historical match to see your accuracy score."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent attempts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.attempts.slice(0, 20).map((attempt) => (
          <li
            key={attempt.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>
                {attempt.eventKey} · {attempt.compLevel.toUpperCase()} {attempt.matchNumber}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                Predicted {trainingWinnerLabel(attempt.predictedWinner)} ({attempt.predictedRedScore}-
                {attempt.predictedBlueScore}) · Actual {trainingWinnerLabel(attempt.actualWinningAlliance)}
                {attempt.actualRedScore != null && attempt.actualBlueScore != null
                  ? ` (${attempt.actualRedScore}-${attempt.actualBlueScore})`
                  : ""}
              </small>
              <span className={`app-badge ${accuracyTone(attempt.accuracyScore)}`}>
                {pct(attempt.accuracyScore)} accuracy
              </span>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "delete-attempt", attemptId: attempt.id })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
