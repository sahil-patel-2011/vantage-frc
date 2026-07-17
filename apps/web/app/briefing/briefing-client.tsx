"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  briefingChecklist,
  matchLabel,
  winProbabilityFor,
  type BriefingChecklistRow,
  type BriefingView,
} from "../../lib/briefing";
import { fmtMatchTime, stripFrc } from "../../lib/schedule-board";
import { fmtTimestamp } from "../../lib/video-review";

/** Where each checklist row sends the coach to fix the gap. */
const CHECKLIST_HREFS: Record<string, string> = {
  Prediction: "/strategy",
  "Strategy plan": "/strategy",
  "Whiteboard play": "/whiteboard",
  "Practice data": "/practice",
  "Opponent video": "/video",
};

function withOrg(href: string, orgId: string | null): string {
  return orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function fmtSeconds(value: number | null): string {
  return value == null ? "—" : `${value}s`;
}

function fmtRate(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

/** Inline "not available — do X" hint reused by the checklist and each empty section. */
function MissingHint({ row, orgId }: { row: BriefingChecklistRow | undefined; orgId: string | null }) {
  if (!row) return null;
  const href = CHECKLIST_HREFS[row.label] ?? "/workspace";
  return (
    <p className="brief-missing">
      <span className="brief-mark no" aria-hidden="true">
        ✗
      </span>
      Not available — <a href={withOrg(href, orgId)}>{row.hint}</a>
    </p>
  );
}

function ChecklistCard({ rows, orgId }: { rows: BriefingChecklistRow[]; orgId: string | null }) {
  const ready = rows.filter((row) => row.ok).length;
  return (
    <section className="app-card brief-checklist">
      <h2>
        Briefing readiness
        <span className="brief-checklist-count">
          {ready}/{rows.length} ready
        </span>
      </h2>
      <ul>
        {rows.map((row) => (
          <li key={row.label} className={row.ok ? "ok" : "no"}>
            <span className={row.ok ? "brief-mark ok" : "brief-mark no"} aria-hidden="true">
              {row.ok ? "✓" : "✗"}
            </span>
            <b>{row.label}</b>
            {row.ok ? null : <a href={withOrg(CHECKLIST_HREFS[row.label] ?? "/workspace", orgId)}>{row.hint}</a>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function BriefingClient() {
  const [view, setView] = useState<BriefingView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const selectedRef = useRef<string | null>(null);

  const load = useCallback(async (matchKey: string | null) => {
    selectedRef.current = matchKey;
    const pageParams = new URLSearchParams(window.location.search);
    const orgId = pageParams.get("orgId");
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    if (matchKey) query.set("matchKey", matchKey);
    const suffix = query.toString();
    try {
      const response = await fetch(`/api/briefing${suffix ? `?${suffix}` : ""}`);
      const data = (await response.json()) as BriefingView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the pre-match briefing.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setFetchFailed(false);
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    const pageParams = new URLSearchParams(window.location.search);
    selectedRef.current = pageParams.get("matchKey");
    void load(selectedRef.current);
    const timer = window.setInterval(() => {
      void load(selectedRef.current);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!view) {
    return (
      <main className="module-page brief-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Briefing</span>
            <h1>Pre-Match Briefing</h1>
          </div>
        </header>
        <div className="app-card brief-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load the pre-match briefing</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current)}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading pre-match briefing…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page brief-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Competition / Briefing</span>
            <h1>Pre-Match Briefing</h1>
            <p>Prediction, game plan, linked play, practice readiness, and opponent film for one match.</p>
          </div>
        </header>
        <div className="app-card brief-empty">
          <strong>Almost there</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Open Workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId;
  const teamKey = view.context.teamNumber != null ? `frc${view.context.teamNumber}` : null;
  const side = view.ourAlliance;
  const ourKeys = side === "red" ? view.match.red : side === "blue" ? view.match.blue : [];
  const oppKeys = side === "red" ? view.match.blue : side === "blue" ? view.match.red : [];
  const partners = ourKeys.filter((key) => key !== teamKey).map(stripFrc);
  const opponents = oppKeys.map(stripFrc);
  const prob = winProbabilityFor(view.prediction, side);
  const checklist = briefingChecklist({
    hasPrediction: view.prediction != null,
    hasPlan: view.plan != null,
    hasPlay: view.play != null,
    practiceReps: view.practice.reps,
    intelCount: view.opponentIntel.length,
    scoutCount: view.scoutCount,
  });
  const rowFor = (label: string) => checklist.find((row) => row.label === label);

  return (
    <main className="module-page brief-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Briefing</span>
          <h1>Pre-Match Briefing</h1>
          <p>
            {view.context.eventName ?? view.context.eventKey}
            {view.context.teamNumber != null ? ` — Team ${view.context.teamNumber}` : ""}
          </p>
        </div>
        <div className="brief-controls">
          <label className="brief-picker">
            <span>Match</span>
            <select value={view.match.matchKey} onChange={(event) => void load(event.target.value)}>
              {view.ourMatches.map((entry) => (
                <option key={entry.matchKey} value={entry.matchKey}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="app-button secondary" onClick={() => void load(selectedRef.current)}>
            Refresh
          </button>
        </div>
      </header>

      {fetchFailed ? (
        <p className="telemetry-status" role="alert">
          {error || "Auto-refresh failed — showing the last loaded briefing."}
        </p>
      ) : null}

      <section className="brief-hero">
        <div className="brief-hero-main">
          <span className="brief-hero-kicker">Up next for the drive team</span>
          <strong className="brief-hero-match">{matchLabel(view.match.compLevel, view.match.matchNumber)}</strong>
          <span className="brief-hero-sub">{fmtMatchTime(view.match.scheduledTime) || "Time TBD"}</span>
          <div className="brief-hero-teams">
            {side ? <span className={`brief-alliance-chip ${side}`}>{side === "red" ? "Red alliance" : "Blue alliance"}</span> : null}
            <span className="brief-hero-lineup">
              With {partners.length ? partners.join(" · ") : "—"}
              <em> vs {opponents.length ? opponents.join(" · ") : "—"}</em>
            </span>
            <span className="brief-chip">
              {view.scoutCount > 0
                ? `${view.scoutCount} ${view.scoutCount === 1 ? "scout" : "scouts"} assigned`
                : "No scouts assigned"}
            </span>
          </div>
        </div>
        {prob != null && view.prediction ? (
          <div className="brief-prob">
            <span className="brief-prob-num">{pct(prob)}</span>
            <span className="brief-prob-label">win probability</span>
            <span className="brief-prob-range">
              confidence {pct(view.prediction.confidenceLow)}–{pct(view.prediction.confidenceHigh)} ·{" "}
              {view.prediction.modelVersion}
            </span>
          </div>
        ) : (
          <div className="brief-prob none">
            <span className="brief-prob-label">No prediction yet</span>
            <a href={withOrg("/strategy", orgId)}>Run Strategy</a>
          </div>
        )}
      </section>

      {view.prediction && (view.prediction.keyFactors.length > 0 || view.prediction.caveats.length > 0) ? (
        <section className="app-card brief-why">
          {view.prediction.keyFactors.length > 0 ? (
            <ul className="brief-factors">
              {view.prediction.keyFactors.slice(0, 3).map((factor, index) => (
                <li key={`${factor.name}-${index}`}>
                  <b>{factor.name}</b>
                  {factor.evidence ? <span> — {factor.evidence}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {view.prediction.caveats.length > 0 ? (
            <p className="brief-caveats">Caveats: {view.prediction.caveats.join(" · ")}</p>
          ) : null}
        </section>
      ) : null}

      <ChecklistCard rows={checklist} orgId={orgId} />

      <div className="brief-grid">
        <section className="app-card brief-section">
          <h2>Game plan</h2>
          {view.plan ? (
            <>
              {view.plan.title ? <p className="brief-plan-title">{view.plan.title}</p> : null}
              {view.plan.priorities.length > 0 ? (
                <ol className="brief-priorities">
                  {view.plan.priorities.map((priority, index) => (
                    <li key={`${index}-${priority}`}>{priority}</li>
                  ))}
                </ol>
              ) : null}
              {view.plan.strengths.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Protect</span>
                  {view.plan.strengths.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip positive">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {view.plan.risks.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Mitigate</span>
                  {view.plan.risks.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip critical">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
              {view.plan.checkpoints.length > 0 ? (
                <div className="brief-chip-row">
                  <span className="brief-chip-label">Checkpoints</span>
                  {view.plan.checkpoints.map((entry, index) => (
                    <span key={`${index}-${entry}`} className="brief-chip">
                      {entry}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <MissingHint row={rowFor("Strategy plan")} orgId={orgId} />
          )}
        </section>

        <section className="app-card brief-section">
          <h2>Linked whiteboard play</h2>
          {view.play ? (
            <>
              <p className="brief-play-title">{view.play.title}</p>
              {view.play.description ? <p className="app-muted brief-play-desc">{view.play.description}</p> : null}
              <p className="brief-play-meta">
                <span className="brief-chip">
                  {view.play.strokeCount} {view.play.strokeCount === 1 ? "stroke" : "strokes"}
                </span>
                <a href={withOrg("/whiteboard", orgId)}>Open in Whiteboard</a>
              </p>
            </>
          ) : (
            <MissingHint row={rowFor("Whiteboard play")} orgId={orgId} />
          )}
        </section>

        <section className="app-card brief-section">
          <h2>Drive-team readiness</h2>
          {view.practice.reps > 0 ? (
            <>
              <div className="brief-stats">
                <div className="brief-stat">
                  <b>{view.practice.reps}</b>
                  <span>reps logged</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtRate(view.practice.successRate)}</b>
                  <span>success</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtSeconds(view.practice.avgSeconds)}</b>
                  <span>avg cycle</span>
                </div>
                <div className="brief-stat">
                  <b>{fmtSeconds(view.practice.bestSeconds)}</b>
                  <span>best cycle</span>
                </div>
              </div>
              {view.practice.topActions.length > 0 ? (
                <table className="brief-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Reps</th>
                      <th>Success</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.practice.topActions.map((entry) => (
                      <tr key={entry.action}>
                        <td>{entry.action}</td>
                        <td>{entry.reps}</td>
                        <td>{fmtRate(entry.successRate)}</td>
                        <td>{fmtSeconds(entry.avgSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : (
            <MissingHint row={rowFor("Practice data")} orgId={orgId} />
          )}
        </section>

        <section className="app-card brief-section">
          <h2>Opponent film</h2>
          {view.opponentIntel.length > 0 ? (
            <ul className="brief-reviews">
              {view.opponentIntel.map((intel, index) => (
                <li key={`${intel.reviewTitle}-${index}`}>
                  <p className="brief-review-head">
                    <b>{intel.reviewTitle}</b>
                    {intel.teamKey ? <span className="brief-chip">{stripFrc(intel.teamKey)}</span> : null}
                  </p>
                  {intel.notes.length > 0 ? (
                    <ul className="brief-notes">
                      {intel.notes.map((note, noteIndex) => (
                        <li key={`${note.atSeconds}-${noteIndex}`}>
                          <span className="brief-ts">{fmtTimestamp(note.atSeconds)}</span>
                          <i className="brief-tag">{note.tag}</i>
                          <span className="brief-note-body">{note.body}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="app-muted brief-no-notes">No timestamped notes yet.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <MissingHint row={rowFor("Opponent video")} orgId={orgId} />
          )}
          {view.opponentIntel.length > 0 ? <a href={withOrg("/video", orgId)}>Open Video Review</a> : null}
        </section>
      </div>
    </main>
  );
}
