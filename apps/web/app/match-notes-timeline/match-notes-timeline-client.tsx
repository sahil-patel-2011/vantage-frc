"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { formatClock, matchNoteCategoryLabel, matchNotePhaseLabel } from "../../lib/match-notes-timeline";
import {
  MATCH_NOTE_CATEGORIES,
  MATCH_NOTE_PHASES,
  type MatchNotesTimelineView,
} from "../../lib/match-notes-timeline/compute-match-notes-timeline";
import type { MatchNoteCategory, MatchNotePhase } from "../../lib/match-notes-timeline/types";

type LiveView = Extract<MatchNotesTimelineView, { status: "live" }>;

export default function MatchNotesTimelineClient() {
  const [view, setView] = useState<MatchNotesTimelineView | null>(null);
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
    void fetch(`/api/match-notes-timeline${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchNotesTimelineView | { error?: string };
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
        const response = await fetch("/api/match-notes-timeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MatchNotesTimelineView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Match Note Timeline"}
          </>
        }
        title="Match Note Timeline"
        description="Log timestamped notes synced to the match clock — auto, teleop, endgame — for film review and drive-coach debriefs."
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
          title="Could not load the match note timeline"
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
          <LogNoteForm busy={busy} mutate={mutate} />
          <Timelines view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Notes logged", value: String(summary.totalEntries) },
    { label: "Matches covered", value: String(summary.totalMatches) },
    { label: "Issues flagged", value: String(summary.byCategory.find((c) => c.category === "issue")?.count ?? 0) },
    { label: "Highlights", value: String(summary.byCategory.find((c) => c.category === "highlight")?.count ?? 0) },
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

function Timelines({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        badge="No notes yet"
        badgeTone="setup"
        title="Log your first match note"
        description="Add a note with the match clock time — during or after a match — to build a replayable timeline."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {view.timelines.map((timeline) => (
        <Panel key={timeline.matchLabel}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{timeline.matchLabel}</h2>
            <small className="app-muted">
              {timeline.entryCount} note{timeline.entryCount === 1 ? "" : "s"}
              {timeline.teamNumber ? ` · Team ${timeline.teamNumber}` : ""}
            </small>
          </header>
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }}>
            {timeline.entries.map((entry) => (
              <li
                key={entry.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
              >
                <div>
                  <strong style={{ fontFamily: "monospace" }}>{formatClock(entry.clockSeconds)}</strong>{" "}
                  <span className="app-badge demo">{matchNotePhaseLabel(entry.phase)}</span>{" "}
                  <span className="app-badge setup">{matchNoteCategoryLabel(entry.category)}</span>
                  <div>{entry.note}</div>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("Delete this note?")) {
                      mutate({ action: "delete-note", entryId: entry.id });
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function LogNoteForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      matchLabel: "",
      matchKey: "",
      teamNumber: "",
      phase: "teleop" as MatchNotePhase,
      category: "observation" as MatchNoteCategory,
      minutes: "",
      seconds: "",
      note: "",
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
        if (!form.matchLabel.trim() || !form.note.trim()) return;
        const clockSeconds = (Number(form.minutes) || 0) * 60 + (Number(form.seconds) || 0);
        mutate({
          action: "log-note",
          matchLabel: form.matchLabel,
          matchKey: form.matchKey || undefined,
          teamNumber: form.teamNumber ? Number(form.teamNumber) : undefined,
          phase: form.phase,
          category: form.category,
          clockSeconds,
          note: form.note,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a note</h2>
      <FormGrid min={160}>
        <FormRow label="Match label">
          <input value={form.matchLabel} onChange={set("matchLabel")} placeholder="Qualification 12" required />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026miket_qm12" />
        </FormRow>
        <FormRow label="Team # (optional)">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} />
        </FormRow>
        <FormRow label="Phase">
          <select value={form.phase} onChange={set("phase")}>
            {MATCH_NOTE_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {matchNotePhaseLabel(phase)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {MATCH_NOTE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {matchNoteCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Clock min">
          <input type="number" min={0} value={form.minutes} onChange={set("minutes")} />
        </FormRow>
        <FormRow label="Clock sec">
          <input type="number" min={0} max={59} value={form.seconds} onChange={set("seconds")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Note">
        <textarea value={form.note} onChange={set("note")} rows={2} required />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.matchLabel.trim() || !form.note.trim()}>
          Log note
        </button>
      </div>
    </Panel>
  );
}
