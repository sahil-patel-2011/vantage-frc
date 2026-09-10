"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { trainingWinnerLabel } from "../../lib/scout-training-mode";
import type { ScoutTrainingView } from "../../lib/scout-training-mode/compute-scout-training-mode";
import type { PracticeMatch, TrainingWinner } from "../../lib/scout-training-mode/types";

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

export default function ScoutTrainingModeClient() {
  const [view, setView] = useState<ScoutTrainingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/scout-training-mode${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutTrainingView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailureStatus(response.status);
          setFailureMessage("error" in data && data.error ? data.error : "");
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
        });
        const data = (await response.json()) as ScoutTrainingView | { error?: string };
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout Training Mode"}
          </>
        }
        title="Scout training mode"
        description="Practice scouting on real, already-completed matches and see how close your call was — the fast way to onboard new scouts before they scout live."
      >
        {orgId ? (
          <Button as="a" variant="secondary" href={`/competition?orgId=${encodeURIComponent(orgId)}`}>
            Back to Competition
          </Button>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
              message:
                failureMessage || "A network or server issue prevented loading. Try again.",
            },
          );
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
          <SummaryTiles view={view} />
          <PracticeForm view={view} busy={busy} mutate={mutate} />
          <RecentAttempts view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
