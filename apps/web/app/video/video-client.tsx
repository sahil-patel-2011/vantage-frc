"use client";

import { useCallback, useEffect, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  fmtTimestamp,
  NOTE_TAGS,
  parseTimestampInput,
  sortNotes,
  TAG_LABELS,
  tagCounts,
  type NoteTag,
  type VideoReview,
  type VideoView,
} from "../../lib/video-review";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function ReviewDetail({
  review,
  orgId,
  busyKey,
  run,
  showError,
}: {
  review: VideoReview;
  orgId: string;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
  showError: (message: string) => void;
}) {
  const [startAt, setStartAt] = useState(0);
  const [filter, setFilter] = useState<NoteTag | "all">("all");
  const [timestamp, setTimestamp] = useState("");
  const [tag, setTag] = useState<NoteTag>("other");
  const [noteBody, setNoteBody] = useState("");
  const [summary, setSummary] = useState(review.summary);
  const busy = busyKey != null;

  const notes = sortNotes(review.notes);
  const counts = tagCounts(review.notes);
  const visible = filter === "all" ? notes : notes.filter((entry) => entry.tag === filter);

  const addNote = () => {
    if (!noteBody.trim()) return;
    let atSeconds: number;
    try {
      atSeconds = parseTimestampInput(timestamp);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Enter a timestamp like 1:23");
      return;
    }
    void run({ action: "add_note", orgId, reviewId: review.id, atSeconds, tag, body: noteBody.trim() }, "add-note").then(() => {
      setTimestamp("");
      setNoteBody("");
    });
  };

  return (
    <section className="vid-detail app-card">
      <header className="vid-detail-head">
        <div>
          <h2>{review.title}</h2>
          <p className="app-muted">
            {review.matchKey ? `${review.matchKey} · ` : ""}
            {review.teamKey ? `${review.teamKey} · ` : ""}
            {notes.length} {notes.length === 1 ? "note" : "notes"}
            {review.createdByName ? ` · by ${review.createdByName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="vid-link danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete review "${review.title}" and all of its notes?`)) {
              void run({ action: "delete_review", orgId, id: review.id }, "delete");
            }
          }}
        >
          Delete review
        </button>
      </header>

      <div className="vid-frame">
        <iframe
          key={startAt}
          title={review.title}
          src={`https://www.youtube-nocookie.com/embed/${review.videoId}?start=${startAt}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <div className="vid-filters" aria-label="Filter notes by tag">
        <button
          type="button"
          className={filter === "all" ? "vid-filter active" : "vid-filter"}
          onClick={() => setFilter("all")}
        >
          All <b>{notes.length}</b>
        </button>
        {NOTE_TAGS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={filter === entry ? "vid-filter active" : "vid-filter"}
            onClick={() => setFilter(entry)}
          >
            {TAG_LABELS[entry]} <b>{counts[entry]}</b>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="app-muted vid-empty-notes">
          {notes.length === 0
            ? "No notes yet — add the first timestamped note below."
            : "No notes match this tag filter."}
        </p>
      ) : (
        <ul className="vid-notes">
          {visible.map((entry) => (
            <li key={entry.id} className="vid-note">
              <button
                type="button"
                className="vid-time"
                title="Jump the player to this moment"
                onClick={() => setStartAt(entry.atSeconds)}
              >
                {fmtTimestamp(entry.atSeconds)}
              </button>
              <span className="vid-tag">{TAG_LABELS[entry.tag]}</span>
              <span className="vid-note-body">
                {entry.body}
                {entry.createdByName ? <small className="app-muted"> · {entry.createdByName}</small> : null}
              </span>
              <button
                type="button"
                className="vid-link danger"
                aria-label="Delete note"
                disabled={busyKey === `note:${entry.id}`}
                onClick={() => void run({ action: "delete_note", orgId, id: entry.id }, `note:${entry.id}`)}
              >
                ✕
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
          placeholder="1:23"
          aria-label="Timestamp"
          disabled={busy}
          onChange={(event) => setTimestamp(event.target.value)}
        />
        <select value={tag} aria-label="Tag" disabled={busy} onChange={(event) => setTag(event.target.value as NoteTag)}>
          {NOTE_TAGS.map((entry) => (
            <option key={entry} value={entry}>
              {TAG_LABELS[entry]}
            </option>
          ))}
        </select>
        <input
          value={noteBody}
          placeholder="Note (e.g. auto missed the second piece)"
          disabled={busy}
          onChange={(event) => setNoteBody(event.target.value)}
        />
        <button type="submit" className="app-button secondary" disabled={busy || !noteBody.trim() || !timestamp.trim()}>
          Add
        </button>
      </form>

      <label className="vid-summary">
        <span className="app-muted">Review summary</span>
        <textarea
          value={summary}
          rows={3}
          placeholder="Overall takeaways from this match…"
          onChange={(event) => setSummary(event.target.value)}
          onBlur={() => {
            if (summary.trim() === review.summary.trim()) return;
            void run({ action: "update_review", orgId, id: review.id, patch: { summary } }, "summary");
          }}
        />
      </label>
    </section>
  );
}

export default function VideoClient() {
  const [view, setView] = useState<VideoView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newMatchKey, setNewMatchKey] = useState("");
  const [newTeamNumber, setNewTeamNumber] = useState("");

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/video${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as VideoView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load video reviews.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
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

  if (fetchFailed || !view) {
    return (
      <main className="module-page vid-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Video Review</span>
            <h1>Match Video Review</h1>
          </div>
        </header>
        <div className="app-card vid-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
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
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button secondary" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading video reviews…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page vid-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Video Review</span>
            <h1>Match Video Review</h1>
            <p>Re-watch match footage with timestamped team notes.</p>
          </div>
        </header>
        <div className="app-card vid-empty">
          <strong>Select a team</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId ?? "";
  const reviews = view.reviews;
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0] ?? null;

  const createReview = () => {
    if (!newTitle.trim() || !newUrl.trim()) return;
    const digits = newTeamNumber.replace(/\D/g, "");
    void run(
      {
        action: "create_review",
        orgId,
        title: newTitle.trim(),
        url: newUrl.trim(),
        matchKey: newMatchKey.trim() || null,
        teamKey: digits ? `frc${digits}` : null,
      },
      "create",
    ).then(() => {
      setNewTitle("");
      setNewUrl("");
      setNewMatchKey("");
      setNewTeamNumber("");
    });
  };

  return (
    <main className="module-page vid-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Video Review</span>
          <h1>Match Video Review</h1>
          <p>
            Re-watch match footage for {view.context.orgName ?? "your team"}
            {view.context.teamNumber ? ` (Team ${view.context.teamNumber})` : ""} — timestamped notes seek the player when
            clicked. This desk plays YouTube only. Hosted photos and clips live in the{" "}
            <a href={withOrgHref("/media-library", orgId)}>Media library</a>.
          </p>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div className="vid-layout">
        <aside className="vid-sidebar">
          <form
            className="vid-new app-card"
            onSubmit={(event) => {
              event.preventDefault();
              createReview();
            }}
          >
            <strong>New review</strong>
            <input
              value={newTitle}
              placeholder="Title (e.g. Q42 vs 254)"
              disabled={busyKey === "create"}
              onChange={(event) => setNewTitle(event.target.value)}
            />
            <input
              value={newUrl}
              placeholder="YouTube URL"
              disabled={busyKey === "create"}
              onChange={(event) => setNewUrl(event.target.value)}
            />
            <input
              value={newMatchKey}
              placeholder="Match key (optional)"
              disabled={busyKey === "create"}
              onChange={(event) => setNewMatchKey(event.target.value)}
            />
            <input
              value={newTeamNumber}
              placeholder="Team number (optional)"
              disabled={busyKey === "create"}
              onChange={(event) => setNewTeamNumber(event.target.value)}
            />
            <button
              type="submit"
              className="app-button"
              disabled={busyKey === "create" || !newTitle.trim() || !newUrl.trim()}
            >
              New review
            </button>
          </form>

          <nav className="vid-nav" aria-label="Saved reviews">
            {reviews.map((review) => (
              <button
                key={review.id}
                type="button"
                className={review.id === selected?.id ? "vid-nav-item active" : "vid-nav-item"}
                onClick={() => setSelectedId(review.id)}
              >
                <strong>{review.title}</strong>
                <span className="vid-nav-sub">
                  {review.notes.length} {review.notes.length === 1 ? "note" : "notes"}
                  {review.matchKey ? <i className="vid-chip">{review.matchKey}</i> : null}
                </span>
              </button>
            ))}
          </nav>
        </aside>

        {selected ? (
          <ReviewDetail key={selected.id} review={selected} orgId={orgId} busyKey={busyKey} run={run} showError={setError} />
        ) : (
          <div className="app-card vid-empty">
            <strong>No reviews yet</strong>
            <p className="app-muted">
              Paste a YouTube match link (TBA match pages link them) and start dropping timestamped notes.
              Hosted MP4/WebM uploads belong in the Media library, not here.
            </p>
          </div>
        )}
      </div>

      <AiInsightPanel
        orgId={orgId}
        kind="video_scout_summary"
        title="Video scout summary"
        description="AI rollup of every timestamped note — recurring failures, defense patterns, and the deepest-reviewed matches."
      />
    </main>
  );
}
