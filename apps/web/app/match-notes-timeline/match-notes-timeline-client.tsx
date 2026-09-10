"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { formatClock, matchNoteCategoryLabel, matchNotePhaseLabel, actionIntervalsFromNotes, actionTrackerStrip } from "../../lib/match-notes-timeline";
import {
  MATCH_NOTE_CATEGORIES,
  MATCH_NOTE_PHASES,
  type MatchNotesTimelineView,
} from "../../lib/match-notes-timeline/compute-match-notes-timeline";
import {
  MATCH_NOTES_TIMELINE_RELATED_INCLUDE,
  classifyMatchNotesTimelineShell,
  formatMatchNotesMetric,
  matchNotesTimelineNextActions,
  matchNotesTimelineRelatedLinks,
  matchNotesTimelineShellCopy,
  shouldShowMatchNotesSummaryTiles,
  type MatchNotesTimelineNextAction,
  type MatchNotesTimelineShellKind,
} from "../../lib/match-notes-timeline/match-notes-timeline-related";
import type { MatchNoteCategory, MatchNotePhase } from "../../lib/match-notes-timeline/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { OfflineBanner } from "../../components/offline-banner";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
} from "../../lib/offline";
import "./match-notes-timeline.css";

type LiveView = Extract<MatchNotesTimelineView, { status: "live" }>;

function MatchNotesRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchNotesTimelineRelatedLinks(orgId, {
    include: [...MATCH_NOTES_TIMELINE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related match-notes-timeline-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function MatchNotesNextActionsPanel({ actions }: { actions: MatchNotesTimelineNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions match-notes-timeline-next-actions"
      aria-label="Next actions"
    >
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

function MatchNotesShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchNotesTimelineShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchNotesTimelineNextActions({ orgId, shell });
  const copy = matchNotesTimelineShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "match-notes-timeline", orgId);

  return (
    <main className="module-page match-notes-timeline-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Note Timeline"}
          </>
        }
        title="Match Note Timeline"
        description={description}
      >
        <MatchNotesRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No notes yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#match-notes-timeline-log">Log a note</Button>
        ) : null}
      </EmptyState>
      <MatchNotesNextActionsPanel actions={actions} />
    </main>
  );
}

export default function MatchNotesTimelineClient() {
  const [view, setView] = useState<MatchNotesTimelineView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void (async () => {
      const cached = urlOrg ? await getFeatureSnapshot<MatchNotesTimelineView>("match-notes", urlOrg) : null;
      if (cached?.data) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
      }
      try {
        const response = await fetch(
          `/api/match-notes-timeline${query.toString() ? `?${query.toString()}` : ""}`,
        );
        const data = (await response.json()) as MatchNotesTimelineView | { error?: string };
        if (!response.ok || !("status" in data)) {
          if (!cached) setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        const cacheOrg = data.status === "live" || data.status === "setup_required" ? data.orgId : urlOrg;
        if (cacheOrg) await putFeatureSnapshot("match-notes", cacheOrg, data);
      } catch {
        if (!cached) setFetchFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const matchCount = view?.status === "live" ? view.summary.totalMatches : 0;
  const summary = view?.status === "live" ? view.summary : null;

  const shell = classifyMatchNotesTimelineShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    entryCount,
  });
  const shellCopy = matchNotesTimelineShellCopy(shell);
  const nextActions = matchNotesTimelineNextActions({
    orgId,
    shell,
    entryCount,
    matchCount,
  });
  const relatedLinks = matchNotesTimelineRelatedLinks(orgId, {
    include: [...MATCH_NOTES_TIMELINE_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "match-notes-timeline", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      if (isBrowserOffline()) {
        await queueProductWrite({
          feature: "match_note",
          orgId,
          payload: { orgId, seasonYear: season ?? undefined, ...payload },
        });
        setError(QUEUED_ON_DEVICE);
        return;
      }
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
        await putFeatureSnapshot("match-notes", orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <MatchNotesShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <MatchNotesShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <MatchNotesShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <MatchNotesShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page match-notes-timeline-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Note Timeline"}
          </>
        }
        title="Match Note Timeline"
        description="Log timestamped notes synced to the match clock — auto, teleop, endgame — for film review and drive-coach debriefs. Cross-check Schedule, Strategy, and Scouting."
      >
        <div className="match-notes-timeline-header-actions">
          {view.seasons.length > 0 ? (
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
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Match notes" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <MatchNotesNextActionsPanel actions={nextActions} />

      {shouldShowMatchNotesSummaryTiles(entryCount) && summary ? (
        <SummaryTiles summary={summary} loaded />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No notes yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#match-notes-timeline-log">
            Log a note
          </Button>
        </EmptyState>
      ) : null}

      <div className="match-notes-timeline-layout">
        <LogNoteForm busy={busy} mutate={mutate} />
        {shell === "ready" ? <Timelines view={view} busy={busy} mutate={mutate} /> : null}
        <Panel className="match-notes-timeline-tip" aria-label="Match Note Timeline tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep match labels aligned with <a href={scheduleHref}>Schedule</a>, ground debriefs in{" "}
            <a href={strategyHref}>Strategy</a>, and pair clock notes with{" "}
            <a href={scoutingHref}>Scouting</a> rows.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({
  summary,
  loaded,
}: {
  summary: LiveView["summary"];
  loaded: boolean;
}) {
  const tiles = [
    { label: "Notes logged", value: formatMatchNotesMetric(summary.totalEntries, loaded) },
    { label: "Matches covered", value: formatMatchNotesMetric(summary.totalMatches, loaded) },
    {
      label: "Issues flagged",
      value: formatMatchNotesMetric(summary.byCategory.find((c) => c.category === "issue")?.count ?? 0, loaded),
    },
    {
      label: "Highlights",
      value: formatMatchNotesMetric(
        summary.byCategory.find((c) => c.category === "highlight")?.count ?? 0,
        loaded,
      ),
    },
  ];
  return (
    <section className="match-notes-timeline-stats" aria-label="Match Note Timeline counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
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
    return null;
  }
  return (
    <div id="match-notes-timeline-list" className="match-notes-timeline-layout">
      {view.timelines.map((timeline) => (
        <Panel key={timeline.matchLabel} className="match-notes-timeline-panel">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <h2 style={{ margin: 0 }}>{timeline.matchLabel}</h2>
            <small className="app-muted">
              {timeline.entryCount} note{timeline.entryCount === 1 ? "" : "s"}
              {timeline.teamNumber ? ` · Team ${timeline.teamNumber}` : ""}
            </small>
          </header>
          <p className="app-muted" style={{ margin: 0, fontFamily: "monospace", letterSpacing: 2 }} aria-label="QRScout-style action tracker">
            {actionTrackerStrip(actionIntervalsFromNotes(timeline.entries))
              .map((cell) => cell || "·")
              .join("")}
          </p>
          <ul className="match-notes-timeline-list">
            {timeline.entries.map((entry) => (
              <li key={entry.id} className="match-notes-timeline-card">
                <div>
                  <strong style={{ fontFamily: "monospace" }}>{formatClock(entry.clockSeconds)}</strong>{" "}
                  <span className="app-badge setup">{matchNotePhaseLabel(entry.phase)}</span>{" "}
                  <span className="app-badge good">{matchNoteCategoryLabel(entry.category)}</span>
                  {entry.source === "video" ? <span className="app-badge">From video</span> : null}
                  <div>{entry.note}</div>
                </div>
                {entry.source === "video" ? null : (
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
                )}
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
      id="match-notes-timeline-log"
      as="form"
      className="match-notes-timeline-panel"
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
    >
      <h2 style={{ margin: 0 }}>Log a note</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Notes use only what you type against the match clock. Paste QRScout hold ranges like{" "}
        <code>12-18,22-30</code> to paint the action tracker.
      </p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.matchLabel.trim() || !form.note.trim()}>
          Log note
        </Button>
      </div>
    </Panel>
  );
}
