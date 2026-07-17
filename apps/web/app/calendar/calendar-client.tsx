"use client";

import { useCallback, useEffect, useState } from "react";
import {
  daysUntil,
  groupByMonth,
  KIND_LABELS,
  MILESTONE_KINDS,
  nextUpcoming,
  seasonProgress,
  type CalendarView,
  type Milestone,
  type MilestoneKind,
} from "../../lib/season-calendar";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function fmtDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function countdownLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function MilestoneRow({
  milestone,
  orgId,
  now,
  busyKey,
  run,
}: {
  milestone: Milestone;
  orgId: string;
  now: Date;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const busy = busyKey != null;
  const past = daysUntil(milestone.startsOn, now) < 0;
  const classes = ["cal-item"];
  if (milestone.done) classes.push("done");
  if (past) classes.push("past");

  return (
    <li className={classes.join(" ")}>
      <label className="cal-check">
        <input
          type="checkbox"
          checked={milestone.done}
          disabled={busyKey === `done:${milestone.id}`}
          aria-label={`Mark "${milestone.title}" ${milestone.done ? "not done" : "done"}`}
          onChange={(event) =>
            void run({ action: "toggle_done", orgId, id: milestone.id, done: event.target.checked }, `done:${milestone.id}`)
          }
        />
      </label>
      <div className="cal-item-main">
        <div className="cal-item-top">
          <strong>{milestone.title}</strong>
          <span className={`cal-chip kind-${milestone.kind}`}>{KIND_LABELS[milestone.kind]}</span>
        </div>
        <span className="cal-item-date">
          {fmtDate(milestone.startsOn)}
          {milestone.endsOn ? ` → ${fmtDate(milestone.endsOn)}` : ""}
          {milestone.done && milestone.doneByName ? (
            <small className="app-muted"> · done by {milestone.doneByName}</small>
          ) : null}
        </span>
        {milestone.notes ? <p className="cal-item-notes app-muted">{milestone.notes}</p> : null}
      </div>
      <button
        type="button"
        className="cal-link danger"
        aria-label="Delete milestone"
        disabled={busy}
        onClick={() => {
          if (confirm(`Delete milestone "${milestone.title}"?`)) {
            void run({ action: "delete_milestone", orgId, id: milestone.id }, `delete:${milestone.id}`);
          }
        }}
      >
        ✕
      </button>
    </li>
  );
}

export default function CalendarClient() {
  const [view, setView] = useState<CalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [kickoff, setKickoff] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("build");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/calendar${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as CalendarView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the season calendar.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page cal-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Season / Calendar</span>
            <h1>Season Calendar</h1>
          </div>
        </header>
        <div className="app-card cal-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load the season calendar</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading season calendar…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page cal-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Season / Calendar</span>
            <h1>Season Calendar</h1>
            <p>Build-season milestones and countdowns from Kickoff through competition.</p>
          </div>
        </header>
        <div className="app-card cal-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const milestones = view.milestones;
  const busy = busyKey != null;
  const now = new Date();
  const next = nextUpcoming(milestones, now);
  const progress = seasonProgress(milestones);
  const months = groupByMonth(milestones);

  const addMilestone = () => {
    if (!title.trim() || !startsOn) return;
    void run(
      {
        action: "add_milestone",
        orgId,
        title: title.trim(),
        kind,
        startsOn,
        endsOn: endsOn || null,
        notes: notes.trim(),
      },
      "add",
    ).then(() => {
      setTitle("");
      setStartsOn("");
      setEndsOn("");
      setNotes("");
    });
  };

  return (
    <main className="module-page cal-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Season / Calendar</span>
          <h1>Season Calendar</h1>
          <p>
            Build-season milestones for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — from Kickoff through competition.
          </p>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="app-card cal-hero">
        <div className="cal-hero-next">
          <span className="cal-hero-kicker">Next milestone</span>
          {next ? (
            <>
              <span className="cal-countdown">{countdownLabel(daysUntil(next.startsOn, now))}</span>
              <div className="cal-hero-title">
                <strong>{next.title}</strong>
                <span className={`cal-chip kind-${next.kind}`}>{KIND_LABELS[next.kind]}</span>
              </div>
              <span className="app-muted">{fmtDate(next.startsOn)}</span>
            </>
          ) : (
            <>
              <strong>Nothing upcoming</strong>
              <span className="app-muted">Seed the build-season template or add a milestone below.</span>
            </>
          )}
        </div>
        <div className="cal-hero-progress">
          <span className="app-muted">
            {progress.done}/{progress.total} milestones done · {progress.percent}%
          </span>
          <div className="cal-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${progress.percent}%` }} className={progress.total > 0 && progress.done === progress.total ? "done" : undefined} />
          </div>
        </div>
      </section>

      <details className="app-card cal-seed">
        <summary>Seed build-season template</summary>
        <div className="cal-seed-body">
          <p className="app-muted">
            Pick your kickoff date — the standard build-season arc (game analysis, design freeze, drivetrain rolling,
            drive practice, feature freeze) is added relative to it. Milestones that already exist are skipped.
          </p>
          <div className="cal-seed-row">
            <input
              type="date"
              value={kickoff}
              disabled={busy}
              aria-label="Kickoff date"
              onChange={(event) => setKickoff(event.target.value)}
            />
            <button
              type="button"
              className="app-button"
              disabled={busy || !kickoff}
              onClick={() => void run({ action: "seed_season", orgId, kickoffDate: kickoff }, "seed")}
            >
              Seed build-season template
            </button>
          </div>
        </div>
      </details>

      {months.length === 0 ? (
        <div className="app-card cal-empty">
          <strong>No milestones yet</strong>
          <p className="app-muted">Seed the build-season template from your kickoff date, or add your first milestone below.</p>
        </div>
      ) : (
        months.map((group) => (
          <section key={group.month} className="cal-month">
            <h2>
              {group.label}
              <span>{group.items.length}</span>
            </h2>
            <ul>
              {group.items.map((milestone) => (
                <MilestoneRow key={milestone.id} milestone={milestone} orgId={orgId} now={now} busyKey={busyKey} run={run} />
              ))}
            </ul>
          </section>
        ))
      )}

      <form
        className="app-card cal-add"
        onSubmit={(event) => {
          event.preventDefault();
          addMilestone();
        }}
      >
        <h2>Add milestone</h2>
        <div className="cal-add-grid">
          <input
            value={title}
            disabled={busy}
            placeholder="Milestone title (e.g. Week 2 scrimmage)"
            onChange={(event) => setTitle(event.target.value)}
          />
          <select value={kind} disabled={busy} aria-label="Kind" onChange={(event) => setKind(event.target.value as MilestoneKind)}>
            {MILESTONE_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
          <input type="date" value={startsOn} disabled={busy} aria-label="Start date" onChange={(event) => setStartsOn(event.target.value)} />
          <input type="date" value={endsOn} disabled={busy} aria-label="End date (optional)" onChange={(event) => setEndsOn(event.target.value)} />
        </div>
        <input value={notes} disabled={busy} placeholder="Notes (optional)" onChange={(event) => setNotes(event.target.value)} />
        <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsOn}>
          Add milestone
        </button>
      </form>
    </main>
  );
}
