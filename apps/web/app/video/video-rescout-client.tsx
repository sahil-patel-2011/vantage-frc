"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "../../components/video-player";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../components/ui";
import {
  classifyLoadFailure,
  loadFailureCopy,
  type LoadFailureCopy,
} from "../../lib/ui/load-failure";
import {
  MAX_RESCOUT_TEAMS,
  normalizeTeamKey,
  scoreCountByTeam,
  scoreMarkerLabel,
  sortTimelineScores,
  type RescoutReview,
  type RescoutSchemaField,
  type RescoutView,
} from "../../lib/video-rescout";
import {
  VIDEO_RESCOUT_RELATED_INCLUDE,
  classifyVideoRescoutShell,
  formatVideoRescoutMetric,
  shouldShowVideoRescoutSummaryTiles,
  videoRescoutNextActions,
  videoRescoutRelatedLinks,
  videoRescoutSetupSteps,
  videoRescoutShellCopy,
  type VideoRescoutNextAction,
  type VideoRescoutShellKind,
} from "../../lib/video-rescout-related";
import {
  fmtTimestamp,
  NOTE_TAGS,
  parseTimestampInput,
  sortNotes,
  TAG_LABELS,
  tagCounts,
  type NoteTag,
} from "../../lib/video-review";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type DetailTab = "notes" | "rescout";
type ReadyView = Extract<RescoutView, { status: "ready" }>;

function teamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

function VideoRescoutRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = videoRescoutRelatedLinks(orgId, {
    include: [...VIDEO_RESCOUT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related vid-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function VideoRescoutNextActionsPanel({ actions }: { actions: VideoRescoutNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions vid-next-actions" aria-label="Next actions">
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VideoRescoutShell({
  description,
  orgId,
  shell,
  error,
  failure,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: VideoRescoutShellKind;
  error?: string;
  /** Diagnosed load failure — decides the copy and the one action that fixes it. */
  failure?: LoadFailureCopy | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = videoRescoutNextActions({ orgId, shell });
  const copy = videoRescoutShellCopy(shell);
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const steps = shell === "setup" ? videoRescoutSetupSteps(orgId) : [];
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page vid-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Video Re-Scout"}
          </>
        }
        title="Post-Match Video Re-Scout"
        description={description}
      >
        <VideoRescoutRelatedStrip orgId={orgId} />
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
                ? "No reviews yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && (!failure || failure.showRetry) ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button is-primary" href={orgId ? scoutingHref : "/workspace"}>{orgId ? "Open Scouting" : "Choose your team"}</a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button is-primary" href="#video-new-review">Add a match review</a>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="vid-soft-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="vid-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted vid-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <VideoRescoutNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

function NewReviewPanel({
  orgId,
  busyKey,
  newTitle,
  newUrl,
  newMatchKey,
  setNewTitle,
  setNewUrl,
  setNewMatchKey,
  onCreate,
}: {
  orgId: string;
  busyKey: string | null;
  newTitle: string;
  newUrl: string;
  newMatchKey: string;
  setNewTitle: (value: string) => void;
  setNewUrl: (value: string) => void;
  setNewMatchKey: (value: string) => void;
  onCreate: () => void;
}) {
  return (
    <Panel className="vid-new" id="video-new-review">
      <strong>New review</strong>
      <p className="app-muted vid-tip">
        Real YouTube match links only. Hosted photos and clips belong in the Media
        library; this desk does not play uploaded MP4s.
      </p>
      <FormRow label="Title">
        <input
          value={newTitle}
          placeholder="Q42 vs 254"
          disabled={busyKey === "create"}
          onChange={(event) => setNewTitle(event.target.value)}
        />
      </FormRow>
      <FormRow label="YouTube URL">
        <input
          value={newUrl}
          placeholder="https://youtube.com/…"
          disabled={busyKey === "create"}
          onChange={(event) => setNewUrl(event.target.value)}
        />
      </FormRow>
      <FormRow label="Match key" hint="Required before commit.">
        <input
          value={newMatchKey}
          placeholder="2026miket_qm12"
          disabled={busyKey === "create"}
          onChange={(event) => setNewMatchKey(event.target.value)}
        />
      </FormRow>
      <button
        type="button"
        className="app-button"
        disabled={busyKey === "create" || !newTitle.trim() || !newUrl.trim() || !orgId}
        onClick={onCreate}
      >
        New review
      </button>
    </Panel>
  );
}

function SummaryTiles({
  reviewCount,
  scoreCount,
  noteCount,
  loaded,
}: {
  reviewCount: number;
  scoreCount: number;
  noteCount: number;
  loaded: boolean;
}) {
  return (
    <section className="vid-kpis" aria-label="Video re-scout summary">
      <article>
        <span>Reviews</span>
        <strong>{formatVideoRescoutMetric(reviewCount, loaded)}</strong>
        <small>saved match clips</small>
      </article>
      <article>
        <span>Timeline scores</span>
        <strong>{formatVideoRescoutMetric(scoreCount, loaded)}</strong>
        <small>stamped on footage</small>
      </article>
      <article>
        <span>Notes</span>
        <strong>{formatVideoRescoutMetric(noteCount, loaded)}</strong>
        <small>timestamped</small>
      </article>
      <article>
        <span>Source</span>
        <strong>Live</strong>
        <small>Your team&apos;s review jobs</small>
      </article>
    </section>
  );
}

export default function VideoRescoutClient() {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [view, setView] = useState<RescoutView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("rescout");
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [activeTeam, setActiveTeam] = useState<string | null>(null);
  const [assignInput, setAssignInput] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteTag | "all">("all");
  const [timestamp, setTimestamp] = useState("");
  const [noteTag, setNoteTag] = useState<NoteTag>("other");
  const [noteBody, setNoteBody] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newMatchKey, setNewMatchKey] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/video/rescout${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as RescoutView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load video re-scout.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
    } catch {
      setFetchFailed(true);
      setErrorStatus(null);
      setError("Network error — please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runVideo = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/video", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string; id?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        if (body.action === "create_review" && data.id) setSelectedId(data.id);
        if (body.action === "delete_review") setSelectedId(null);
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const runRescout = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/video/rescout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Re-scout action failed.");
          return;
        }
        await load();
      } catch {
        setError("Network error — re-scout changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const orgId = view?.status === "ready" ? view.context.orgId : null;
  const reviews = view?.status === "ready" ? view.reviews : [];
  const reviewCount = reviews.length;
  const scoreCount = reviews.reduce((sum, review) => sum + review.scores.length, 0);
  const noteCount = reviews.reduce((sum, review) => sum + review.notes.length, 0);

  const shell = classifyVideoRescoutShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    reviewCount,
  });
  const shellCopy = videoRescoutShellCopy(shell);
  const nextActions = videoRescoutNextActions({
    orgId,
    shell,
    reviewCount,
    scoreCount,
  });
  const competitionHref = hubHref("/competition", "scouting", orgId);
  const showTiles = shouldShowVideoRescoutSummaryTiles({ reviewCount, scoreCount });
  const loaded = view?.status === "ready";

  const createReview = () => {
    if (!orgId || !newTitle.trim() || !newUrl.trim()) return;
    void runVideo(
      {
        action: "create_review",
        orgId,
        title: newTitle.trim(),
        url: newUrl.trim(),
        matchKey: newMatchKey.trim() || null,
        teamKey: null,
      },
      "create",
    ).then(() => {
      setNewTitle("");
      setNewUrl("");
      setNewMatchKey("");
    });
  };

  if (shell === "loading") {
    return <VideoRescoutShell description={shellCopy.description} orgId={orgId} shell="loading" />;
  }

  if (shell === "error") {
    const failure = loadFailureCopy(
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
        message: error || shellCopy.description,
      },
    );
    return (
      <VideoRescoutShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        failure={failure}
        onRetry={() => void load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <VideoRescoutShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (shell === "empty" || view?.status !== "ready" || !orgId) {
    return (
      <VideoRescoutShell description={shellCopy.description} orgId={orgId} shell="empty">
        {orgId ? (
          <NewReviewPanel
            orgId={orgId}
            busyKey={busyKey}
            newTitle={newTitle}
            newUrl={newUrl}
            newMatchKey={newMatchKey}
            setNewTitle={setNewTitle}
            setNewUrl={setNewUrl}
            setNewMatchKey={setNewMatchKey}
            onCreate={createReview}
          />
        ) : null}
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
      </VideoRescoutShell>
    );
  }

  const readyView = view as ReadyView;
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0] ?? null;
  const schemaFields = readyView.matchSchema?.fields ?? [];
  const assignedTeams = selected?.assignedTeamKeys ?? [];
  const activeTeamKey = activeTeam && assignedTeams.includes(activeTeam) ? activeTeam : assignedTeams[0] ?? null;
  const scoreCounts = selected ? scoreCountByTeam(selected.scores, assignedTeams) : {};
  const visibleScores = selected
    ? sortTimelineScores(
        activeTeamKey ? selected.scores.filter((entry) => entry.teamKey === activeTeamKey) : selected.scores,
      )
    : [];

  const saveAssignments = () => {
    if (!selected) return;
    try {
      const keys = assignInput
        .split(/[\s,]+/)
        .filter(Boolean)
        .slice(0, MAX_RESCOUT_TEAMS)
        .map((entry) => normalizeTeamKey(entry));
      void runRescout(
        { action: "set_assigned_teams", orgId, reviewId: selected.id, teamKeys: [...new Set(keys)] },
        "assign",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid team assignment.");
    }
  };

  const addScore = (field: RescoutSchemaField, value: unknown) => {
    if (!selected || !activeTeamKey) return;
    void runRescout(
      {
        action: "add_score",
        orgId,
        reviewId: selected.id,
        teamKey: activeTeamKey,
        atSeconds: currentSeconds,
        fieldKey: field.key,
        value,
      },
      `score:${field.key}:${currentSeconds}`,
    );
  };

  const commitRescout = () => {
    if (!selected || !readyView.matchSchema) return;
    void runRescout(
      {
        action: "commit_rescout",
        orgId,
        reviewId: selected.id,
        schemaId: readyView.matchSchema.id,
        confidence: "normal",
      },
      "commit",
    );
  };

  const addNote = () => {
    if (!selected || !noteBody.trim()) return;
    let atSeconds: number;
    try {
      atSeconds = timestamp.trim() ? parseTimestampInput(timestamp) : currentSeconds;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a timestamp like 1:23");
      return;
    }
    void runVideo(
      { action: "add_note", orgId, reviewId: selected.id, atSeconds, tag: noteTag, body: noteBody.trim() },
      "add-note",
    ).then(() => {
      setTimestamp("");
      setNoteBody("");
    });
  };

  const renderNotes = (review: RescoutReview) => {
    const notes = sortNotes(review.notes);
    const counts = tagCounts(review.notes);
    const visible = noteFilter === "all" ? notes : notes.filter((entry) => entry.tag === noteFilter);
    return (
      <div className="vid-detail">
        <div className="vid-filters" aria-label="Filter notes by tag">
          <button type="button" className={noteFilter === "all" ? "vid-filter active" : "vid-filter"} onClick={() => setNoteFilter("all")}>
            All <b>{notes.length}</b>
          </button>
          {NOTE_TAGS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={noteFilter === entry ? "vid-filter active" : "vid-filter"}
              onClick={() => setNoteFilter(entry)}
            >
              {TAG_LABELS[entry]} <b>{counts[entry]}</b>
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="app-muted">No notes yet — add timestamped notes while you re-watch.</p>
        ) : (
          <ul className="vid-notes">
            {visible.map((entry) => (
              <li key={entry.id} className="vid-note">
                <button type="button" className="vid-time" onClick={() => playerRef.current?.seekTo(entry.atSeconds)}>
                  {fmtTimestamp(entry.atSeconds)}
                </button>
                <span className="vid-tag">{TAG_LABELS[entry.tag]}</span>
                <span className="vid-note-body">{entry.body}</span>
                <button
                  type="button"
                  className="vid-link danger"
                  disabled={busyKey === `note:${entry.id}`}
                  onClick={() => void runVideo({ action: "delete_note", orgId, id: entry.id }, `note:${entry.id}`)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="vid-add"
          onSubmit={(event) => {
            event.preventDefault();
            addNote();
          }}
        >
          <input
            className="vid-ts-input"
            value={timestamp}
            placeholder={fmtTimestamp(currentSeconds)}
            aria-label="Timestamp"
            disabled={busyKey != null}
            onChange={(event) => setTimestamp(event.target.value)}
          />
          <select value={noteTag} aria-label="Tag" disabled={busyKey != null} onChange={(event) => setNoteTag(event.target.value as NoteTag)}>
            {NOTE_TAGS.map((entry) => (
              <option key={entry} value={entry}>
                {TAG_LABELS[entry]}
              </option>
            ))}
          </select>
          <input
            value={noteBody}
            placeholder="Timestamped note"
            disabled={busyKey != null}
            onChange={(event) => setNoteBody(event.target.value)}
          />
          <button type="submit" className="app-button secondary" disabled={busyKey != null || !noteBody.trim()}>
            Add note
          </button>
        </form>
      </div>
    );
  };

  const renderRescout = (review: RescoutReview) => (
    <div className="vid-rescout" id="video-timeline">
      <Panel className="vid-team-assign">
        <strong>Assigned teams (1–{MAX_RESCOUT_TEAMS})</strong>
        <FormRow label="Team numbers" hint="Comma or space separated. Saved per review.">
          <input
            value={assignInput}
            placeholder={assignedTeams.map(teamLabel).join(", ") || "254, 1678"}
            disabled={busyKey === "assign"}
            onChange={(event) => setAssignInput(event.target.value)}
            onFocus={() => {
              if (!assignInput && assignedTeams.length) setAssignInput(assignedTeams.map(teamLabel).join(", "));
            }}
          />
        </FormRow>
        <div className="vid-team-chips" aria-label="Active team for scoring">
          {assignedTeams.map((teamKey) => (
            <button
              key={teamKey}
              type="button"
              className={teamKey === activeTeamKey ? "vid-team-chip active" : "vid-team-chip"}
              onClick={() => setActiveTeam(teamKey)}
            >
              {teamLabel(teamKey)}
              <span>{scoreCounts[teamKey] ?? 0}</span>
            </button>
          ))}
        </div>
        <button type="button" className="app-button secondary" disabled={busyKey === "assign"} onClick={saveAssignments}>
          Save assignment
        </button>
      </Panel>

      {!readyView.matchSchema ? (
        <EmptyState
          soft
          badge="Schema required"
          badgeTone="setup"
          title="Match schema required"
          description="Configure a real match scouting schema before timeline scoring."
        >
          <a className="app-button" href={hubHref("/competition", "scouting", orgId)}>
            Open Scouting
          </a>
        </EmptyState>
      ) : !activeTeamKey ? (
        <EmptyState soft title="Assign teams" description="Add up to four alliance teams, then tap score buttons at the playhead." />
      ) : (
        <Panel className="vid-score-pad">
          <strong>
            Score pad · {teamLabel(activeTeamKey)} @ {fmtTimestamp(currentSeconds)}
          </strong>
          <div className="vid-score-grid">
            {schemaFields.map((field) => {
              if (field.type === "number") {
                return (
                  <button key={field.key} type="button" className="vid-score-btn" onClick={() => addScore(field, 1)}>
                    <small>{field.label}</small>
                    <strong>+1</strong>
                  </button>
                );
              }
              if (field.type === "boolean") {
                return (
                  <button key={field.key} type="button" className="vid-score-btn" onClick={() => addScore(field, true)}>
                    <small>{field.label}</small>
                    <strong>Yes</strong>
                  </button>
                );
              }
              if (field.type === "select") {
                return (field.options ?? []).map((option) => (
                  <button key={`${field.key}:${option}`} type="button" className="vid-score-btn" onClick={() => addScore(field, option)}>
                    <small>{field.label}</small>
                    <strong>{option}</strong>
                  </button>
                ));
              }
              return (
                <button
                  key={field.key}
                  type="button"
                  className="vid-score-btn"
                  onClick={() => {
                    const text = window.prompt(`${field.label} note`);
                    if (text?.trim()) addScore(field, text.trim());
                  }}
                >
                  <small>{field.label}</small>
                  <strong>Text</strong>
                </button>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel>
        <strong>Timeline scores</strong>
        {visibleScores.length === 0 ? (
          <p className="app-muted">No timeline scores yet for this team.</p>
        ) : (
          <ul className="vid-timeline">
            {visibleScores.map((entry) => (
              <li key={entry.id} className="vid-timeline-item">
                <button type="button" className="vid-time" onClick={() => playerRef.current?.seekTo(entry.atSeconds)}>
                  {fmtTimestamp(entry.atSeconds)}
                </button>
                <span className="vid-marker">
                  {teamLabel(entry.teamKey)} · {scoreMarkerLabel(entry.fieldKey, entry.value)}
                  {entry.createdByName ? <small className="app-muted"> · {entry.createdByName}</small> : null}
                </span>
                <button
                  type="button"
                  className="vid-link danger"
                  disabled={busyKey === `score:${entry.id}`}
                  onClick={() => void runRescout({ action: "delete_score", orgId, id: entry.id }, `score:${entry.id}`)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="vid-commit">
        <button
          type="button"
          className="app-button"
          disabled={busyKey === "commit" || !readyView.matchSchema || assignedTeams.length === 0 || !review.matchKey}
          onClick={commitRescout}
        >
          Commit re-scout to scouting
        </button>
        {!review.matchKey ? <span className="app-muted">Link this review to a match key before commit.</span> : null}
      </div>
    </div>
  );

  return (
    <main className="module-page vid-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Video Re-Scout"}
          </>
        }
        title="Post-Match Video Re-Scout"
        description={`Re-watch real match footage for ${readyView.context.orgName ?? "your team"} and drop timeline scores into scouting.`}
      >
        <div className="vid-header-meta">
          <VideoRescoutRelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <SummaryTiles reviewCount={reviewCount} scoreCount={scoreCount} noteCount={noteCount} loaded={loaded} />
      ) : null}

      <div className="vid-layout">
        <aside className="vid-sidebar">
          <NewReviewPanel
            orgId={orgId}
            busyKey={busyKey}
            newTitle={newTitle}
            newUrl={newUrl}
            newMatchKey={newMatchKey}
            setNewTitle={setNewTitle}
            setNewUrl={setNewUrl}
            setNewMatchKey={setNewMatchKey}
            onCreate={createReview}
          />

          <nav className="vid-nav" id="video-reviews" aria-label="Saved reviews">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                className={review.id === selected?.id ? "vid-nav-item active" : "vid-nav-item"}
                onClick={() => setSelectedId(review.id)}
              >
                <strong>{review.title}</strong>
                <span className="vid-nav-sub">
                  {review.scores.length} scores · {review.notes.length} notes
                  {review.matchKey ? <i className="vid-chip">{review.matchKey}</i> : null}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {selected ? (
          <Panel className="vid-detail">
            <header className="vid-detail-head">
              <div>
                <h2>{selected.title}</h2>
                <p className="app-muted">
                  {selected.matchKey ? `${selected.matchKey} · ` : ""}
                  {assignedTeams.length ? `${assignedTeams.length} teams assigned · ` : ""}
                  {readyView.matchSchema?.title ?? "No match schema"}
                </p>
              </div>
              <button
                type="button"
                className="vid-link danger"
                disabled={busyKey != null}
                onClick={() => {
                  if (confirm(`Delete review "${selected.title}"?`)) {
                    void runVideo({ action: "delete_review", orgId, id: selected.id }, "delete");
                  }
                }}
              >
                Delete review
              </button>
            </header>

            <VideoPlayer ref={playerRef} videoId={selected.videoId} title={selected.title} onTimeUpdate={setCurrentSeconds} />

            <TabBar
              aria-label="Review detail tabs"
              value={detailTab}
              onChange={(id) => setDetailTab(id as DetailTab)}
              tabs={[
                { id: "rescout", label: "Re-scout" },
                { id: "notes", label: "Notes" },
              ]}
            />

            {detailTab === "notes" ? renderNotes(selected) : renderRescout(selected)}
          </Panel>
        ) : (
          <EmptyState soft title="No reviews yet" description="Paste a YouTube match link and assign up to four teams to re-scout." />
        )}
      </div>

      <VideoRescoutNextActionsPanel actions={nextActions} />
      <p className="app-muted vid-footer-links">
        Also see{" "}
        <a href={hubHref("/competition", "scouting", orgId)}>Scouting</a>
        {" · "}
        <a href={withOrgHref("/scout-accuracy", orgId)}>Accuracy</a>
        {" · "}
        <a href={withOrgHref("/scout-disagreements", orgId)}>Disagreements</a>
      </p>
    </main>
  );
}
