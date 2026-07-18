"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoPlayer, type VideoPlayerHandle } from "../../components/video-player";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../components/ui";
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
  fmtTimestamp,
  NOTE_TAGS,
  parseTimestampInput,
  sortNotes,
  TAG_LABELS,
  tagCounts,
  type NoteTag,
} from "../../lib/video-review";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type DetailTab = "notes" | "rescout";

function teamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export default function VideoRescoutClient() {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [view, setView] = useState<RescoutView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
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

  if (fetchFailed || !view) {
    return (
      <main className="module-page vid-page">
        <PageHeader navPath="/video" title="Post-Match Video Re-Scout" description="Loading match footage and timeline scores…" />
        <EmptyState soft title={fetchFailed ? "Could not load video re-scout" : "Loading…"} description={error || "Checking workspace and saved reviews."}>
          {fetchFailed ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page vid-page">
        <PageHeader navPath="/video" title="Post-Match Video Re-Scout" description={view.message} />
        <EmptyState soft badge="Setup required" badgeTone="setup" title="Select a team workspace" description={view.message}>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  const orgId = view.context.orgId;
  const reviews = view.reviews;
  const selected = reviews.find((review) => review.id === selectedId) ?? reviews[0] ?? null;
  const schemaFields = view.matchSchema?.fields ?? [];
  const assignedTeams = selected?.assignedTeamKeys ?? [];
  const activeTeamKey = activeTeam && assignedTeams.includes(activeTeam) ? activeTeam : assignedTeams[0] ?? null;
  const scoreCounts = selected ? scoreCountByTeam(selected.scores, assignedTeams) : {};
  const visibleScores = selected
    ? sortTimelineScores(
        activeTeamKey ? selected.scores.filter((entry) => entry.teamKey === activeTeamKey) : selected.scores,
      )
    : [];

  const createReview = () => {
    if (!newTitle.trim() || !newUrl.trim()) return;
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
    if (!selected || !view.matchSchema) return;
    void runRescout(
      {
        action: "commit_rescout",
        orgId,
        reviewId: selected.id,
        schemaId: view.matchSchema.id,
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
    <div className="vid-rescout">
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

      {!view.matchSchema ? (
        <EmptyState soft title="Match schema required" description="Configure a match scouting schema before timeline scoring." />
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
          disabled={busyKey === "commit" || !view.matchSchema || assignedTeams.length === 0 || !review.matchKey}
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
        navPath="/video"
        title="Post-Match Video Re-Scout"
        description={`Re-watch match footage for ${view.context.orgName ?? "your team"} and drop timeline scores into scouting.`}
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div className="vid-layout">
        <aside className="vid-sidebar">
          <Panel className="vid-new">
            <strong>New review</strong>
            <FormRow label="Title">
              <input value={newTitle} placeholder="Q42 vs 254" disabled={busyKey === "create"} onChange={(event) => setNewTitle(event.target.value)} />
            </FormRow>
            <FormRow label="YouTube URL">
              <input value={newUrl} placeholder="https://youtube.com/…" disabled={busyKey === "create"} onChange={(event) => setNewUrl(event.target.value)} />
            </FormRow>
            <FormRow label="Match key" hint="Required before commit.">
              <input value={newMatchKey} placeholder="2026miket_qm12" disabled={busyKey === "create"} onChange={(event) => setNewMatchKey(event.target.value)} />
            </FormRow>
            <button type="button" className="app-button" disabled={busyKey === "create" || !newTitle.trim() || !newUrl.trim()} onClick={createReview}>
              New review
            </button>
          </Panel>

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
                  {view.matchSchema?.title ?? "No match schema"}
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

            <VideoPlayer
              ref={playerRef}
              videoId={selected.videoId}
              title={selected.title}
              onTimeUpdate={setCurrentSeconds}
            />

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
    </main>
  );
}
