"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CompetitionHubRelated } from "../../components/competition-hub-related";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { checklistItemLabel, formatElapsed } from "../../lib/match-checklist";
import type { MatchChecklistView } from "../../lib/match-checklist/compute-match-checklist";
import {
  MATCH_CHECKLIST_RELATED_INCLUDE,
  formatItemProgress,
  matchChecklistNextActions,
  shouldShowSummaryTiles,
  summaryHasTimingEvidence,
} from "../../lib/match-checklist/match-checklist-related";
import type { ChecklistItem, ChecklistItemKey, MatchChecklistRun } from "../../lib/match-checklist/types";
import "./match-checklist.css";

type LiveView = Extract<MatchChecklistView, { status: "live" }>;

export default function MatchChecklistClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<MatchChecklistView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/match-checklist${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchChecklistView | { error?: string };
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

  // Tick every second so open runs show a live-updating elapsed time.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-checklist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as MatchChecklistView | { error?: string };
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

  const relatedOrg = orgId ?? undefined;
  const nextActions = matchChecklistNextActions({
    orgId,
    runs: view?.status === "live" ? view.runs : [],
    upcomingMatches: view?.status === "live" ? view.upcomingMatches : [],
  });

  return (
    <main className="module-page mcl-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>
              Competition
            </a>
            {" / Match Checklist"}
          </>
        }
        title="Pre-Match Checklist"
        description="One-tap timed checklist per match — bumpers, battery strap, SB50 lock, tether, code — so pit crews hang the correct set and don't lose power. Progress comes only from real checks."
      />

      {orgId ? (
        <div className="mcl-related">
          <CompetitionHubRelated
            orgId={relatedOrg}
            active="match-checklist"
            include={[...MATCH_CHECKLIST_RELATED_INCLUDE]}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mcl-alert" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          soft
          title="Could not load the checklist"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState soft title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <div className="mcl-stack">
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
          <NextActionsPanel actions={nextActions} />
        </div>
      ) : (
        <div className="mcl-stack">
          {shouldShowSummaryTiles(view.summary) ? <SummaryTiles view={view} /> : null}
          <NextActionsPanel actions={nextActions} />
          <StartRunForm
            busy={busy}
            mutate={mutate}
            teamNumber={view.teamNumber}
            upcomingMatches={view.upcomingMatches}
            activeEventKey={view.activeEventKey}
          />
          <RunList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function NextActionsPanel({
  actions,
}: {
  actions: ReturnType<typeof matchChecklistNextActions>;
}) {
  if (actions.length === 0) return null;
  return (
    <Panel className="mcl-next-actions">
      <header>
        <h2>Next actions</h2>
        <p>Real event paths only — checklist progress stays blank until you check items.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const showTiming = summaryHasTimingEvidence(summary);
  const tiles = [
    { label: "Total runs", value: String(summary.totalRuns), tone: "" },
    { label: "Ready", value: String(summary.completedRuns), tone: "ready" },
    { label: "In progress", value: String(summary.openRuns), tone: summary.openRuns > 0 ? "open" : "" },
    {
      label: "Avg ready time",
      value: showTiming ? formatElapsed(summary.averageElapsedSeconds) : "—",
      tone: "",
    },
    {
      label: "Fastest",
      value: showTiming ? formatElapsed(summary.fastestElapsedSeconds) : "—",
      tone: "",
    },
  ];
  return (
    <div className="mcl-summary" aria-label="Checklist summary from real runs">
      {tiles.map((tile) => (
        <div key={tile.label} className={["mcl-summary-tile", tile.tone].filter(Boolean).join(" ")}>
          <strong>{tile.value}</strong>
          <span>{tile.label}</span>
        </div>
      ))}
    </div>
  );
}

function StartRunForm({
  busy,
  mutate,
  teamNumber,
  upcomingMatches,
  activeEventKey,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  teamNumber: number | null;
  upcomingMatches: LiveView["upcomingMatches"];
  activeEventKey: string | null;
}) {
  const empty = useMemo(() => ({ matchLabel: "", eventKey: "", teamNumber: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const next = upcomingMatches[0] ?? null;

  return (
    <Panel
      as="form"
      className="mcl-start"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.matchLabel.trim()) return;
        mutate({
          action: "start-run",
          matchLabel: form.matchLabel,
          eventKey: form.eventKey || undefined,
          teamNumber: form.teamNumber ? Number(form.teamNumber) : teamNumber ?? undefined,
        });
        setForm(empty);
      }}
    >
      <div>
        <h2>Start checklist</h2>
        <p className="mcl-start-hint">
          Labels start empty — item progress and elapsed time appear only after you tap real pit checks.
        </p>
        {next ? (
          <p className={`mcl-bumper-cue ${next.bumperColor}`} role="status">
            Next from TBA: hang <strong>{next.bumperColor.toUpperCase()} bumpers</strong> for {next.label}. Color stays
            blank until the alliance lists are in cache.
          </p>
        ) : (
          <p className="mcl-start-hint">
            Bumper color stays unknown until the active event schedule is synced — never guessed.
          </p>
        )}
      </div>
      {upcomingMatches.length > 0 ? (
        <div className="mcl-upcoming" aria-label="Upcoming matches from TBA">
          {upcomingMatches.map((match) => (
            <button
              key={match.matchKey}
              type="button"
              className={`mcl-upcoming-chip ${match.bumperColor}`}
              disabled={busy}
              onClick={() =>
                setForm({
                  matchLabel: match.label,
                  eventKey: match.eventKey,
                  teamNumber: teamNumber != null ? String(teamNumber) : "",
                })
              }
            >
              {match.label} · {match.bumperColor.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}
      <FormGrid min={160}>
        <FormRow label="Match">
          <input
            value={form.matchLabel}
            onChange={set("matchLabel")}
            placeholder={next?.label ?? "Qualification 12"}
            required
            list="mcl-upcoming-labels"
          />
          <datalist id="mcl-upcoming-labels">
            {upcomingMatches.map((match) => (
              <option key={match.matchKey} value={match.label} />
            ))}
          </datalist>
        </FormRow>
        <FormRow label="Event (optional)">
          <input
            value={form.eventKey}
            onChange={set("eventKey")}
            placeholder={activeEventKey ?? "2026miket"}
          />
        </FormRow>
        <FormRow label="Team # (optional)">
          <input
            type="number"
            min={1}
            value={form.teamNumber}
            onChange={set("teamNumber")}
            placeholder={teamNumber != null ? String(teamNumber) : ""}
          />
        </FormRow>
      </FormGrid>
      <div className="mcl-start-actions">
        <button type="submit" className="app-button" disabled={busy || !form.matchLabel.trim()}>
          {busy ? "Working…" : "Start checklist"}
        </button>
      </div>
    </Panel>
  );
}

function RunList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.runs.length === 0) {
    return (
      <div className="mcl-empty">
        <EmptyState
          soft
          badge="No checklists yet"
          badgeTone="setup"
          title="Start your first pre-match checklist"
          description="Tap through bumper color, battery strap, SB50 lock, tether, and code before every match. Timing and readiness stay blank until you check items — nothing is invented."
        />
      </div>
    );
  }

  const openCount = view.runs.filter((run) => !run.allDone).length;

  return (
    <section className="mcl-runs" aria-label="Checklist runs">
      <header className="mcl-runs-head">
        <h2>Match runs</h2>
        <p>
          {view.runs.length} recorded
          {openCount > 0 ? ` · ${openCount} still open` : " · all ready"}
        </p>
      </header>
      {view.runs.map((run) => (
        <RunCard key={run.id} run={run} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function formatCheckedAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function RunCard({
  run,
  busy,
  mutate,
}: {
  run: MatchChecklistRun;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const elapsed =
    run.startedAt != null
      ? Math.max(
          0,
          Math.round(
            ((run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
              new Date(run.startedAt).getTime()) /
              1000,
          ),
        )
      : null;

  const progress = formatItemProgress(run.items);

  return (
    <article className={["mcl-run", run.allDone ? "is-ready" : "is-open"].join(" ")}>
      <header className="mcl-run-top">
        <div className="mcl-run-who">
          <div className="mcl-badges">
            <span className={`mcl-badge ${run.allDone ? "ready" : "open"}`}>
              {run.allDone ? "Ready" : "In progress"}
            </span>
            {run.bumperColor ? (
              <span className={`mcl-badge bumper ${run.bumperColor}`}>
                {run.bumperColor.toUpperCase()} bumpers
              </span>
            ) : null}
            <span className="mcl-badge progress">{progress}</span>
            <span className="mcl-timer" aria-label="Elapsed time">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <h3>{run.matchLabel}</h3>
          <span className="mcl-run-meta">
            {run.eventKey ? `${run.eventKey} · ` : ""}
            {run.teamNumber ? `Team ${run.teamNumber} · ` : ""}
            Started{" "}
            {new Date(run.startedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete checklist for "${run.matchLabel}"?`)) {
              mutate({ action: "delete-run", runId: run.id });
            }
          }}
        >
          Delete
        </button>
      </header>
      <ul className="mcl-items">
        {run.items.map((item) => (
          <ItemToggle
            key={item.key}
            item={item}
            busy={busy}
            runId={run.id}
            mutate={mutate}
            bumperColor={run.bumperColor}
          />
        ))}
      </ul>
    </article>
  );
}

function ItemToggle({
  item,
  busy,
  runId,
  mutate,
  bumperColor,
}: {
  item: ChecklistItem;
  busy: boolean;
  runId: string;
  mutate: (payload: Record<string, unknown>) => void;
  bumperColor: MatchChecklistRun["bumperColor"];
}) {
  const checkedLabel = formatCheckedAt(item.checkedAt);
  return (
    <li>
      <button
        type="button"
        className={[
          "mcl-item",
          item.done ? "is-done" : "",
          item.key === "bumper" && bumperColor ? `bumper-${bumperColor}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={busy}
        aria-pressed={item.done}
        onClick={() => mutate({ action: "toggle-item", runId, itemKey: item.key as ChecklistItemKey })}
      >
        <span className="mcl-item-main">
          <strong>{checklistItemLabel(item.key)}</strong>
          <small>{item.done ? (checkedLabel ? `Checked ${checkedLabel}` : "Checked") : "Tap when done"}</small>
        </span>
        <span className="mcl-item-mark" aria-hidden>
          {item.done ? "✓" : ""}
        </span>
      </button>
    </li>
  );
}
