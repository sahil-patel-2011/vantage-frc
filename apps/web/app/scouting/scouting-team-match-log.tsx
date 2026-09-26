"use client";

/**
 * One robot, match by match, under the team detail.
 *
 * Two columns of numbers never share a label: "Our scouts" is what our entries
 * recorded (averaged when two scouts watched the same match), "Official" is
 * what TBA posted for the whole alliance. The summary chips are built from our
 * scouts' totals only and say "not enough matches" instead of averaging one.
 */

import { useEffect, useMemo, useState } from "react";
import type { TeamMatchLogView } from "../../lib/scouting/team-match-log-load";
import { MIN_SUMMARY_MATCHES, sharedFieldTeams, summarizeTeamMatches } from "../../lib/scouting/team-match-log";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { withOrgHref } from "../../lib/nav/product-nav";
import { MEDIA_ENABLED } from "../../lib/media-availability";
import "./scouting-team-match-log.css";

function num(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

function fmt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Chip({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stml-chip" title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ScoutingTeamMatchLog({
  orgId,
  eventKey,
  teamKey,
}: {
  orgId: string;
  eventKey: string | null;
  teamKey: string;
}) {
  const [view, setView] = useState<TeamMatchLogView | null>(null);
  const [failed, setFailed] = useState(false);
  const [relativeTo, setRelativeTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setFailed(false);
    setRelativeTo("");
    void (async () => {
      try {
        const params = new URLSearchParams({ orgId, teamKey });
        if (eventKey) params.set("eventKey", eventKey);
        const response = await fetch(`/api/scouting/team-matches?${params}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (!response.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const body = (await response.json()) as TeamMatchLogView;
        if (!cancelled) setView(body);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, eventKey, teamKey]);

  const rows = useMemo(() => (view?.status === "ready" ? view.rows : []), [view]);
  const summary = useMemo(() => summarizeTeamMatches(rows, { relativeTo: relativeTo || null }), [rows, relativeTo]);
  const shared = useMemo(() => sharedFieldTeams(rows), [rows]);

  if (failed) {
    return <p className="stml-empty">Could not load this robot’s matches. They will load when the connection is back.</p>;
  }
  if (!view) return <p className="stml-empty" aria-busy="true">Loading matches…</p>;
  if (view.status !== "ready") return <p className="stml-empty">{view.message}</p>;

  const notEnough = "not enough matches";
  const relative = summary.relative;

  return (
    <section className="stml" aria-label={`Team ${num(teamKey)} match by match`}>
      <header className="stml-head">
        <h4>Match by match</h4>
        <p>
          <b className="stml-src observed">Our scouts</b> = what our entries recorded.{" "}
          <b className="stml-src official">Official</b> = the alliance’s posted score.
        </p>
      </header>

      {view.totalBasis.ok ? (
        <div className="stml-chips">
          <Chip
            label="Average"
            value={summary.average != null ? fmt(summary.average) : notEnough}
            hint={`Our scouts’ total, ${summary.matches} match${summary.matches === 1 ? "" : "es"}`}
          />
          <Chip label="Best" value={summary.best != null ? fmt(summary.best) : notEnough} />
          <Chip label="Worst" value={summary.worst != null ? fmt(summary.worst) : notEnough} />
          <Chip label="Last 3" value={summary.lastThree != null ? fmt(summary.lastThree) : notEnough} />
        </div>
      ) : (
        <p className="stml-empty">{view.totalBasis.reason}</p>
      )}

      {view.totalBasis.ok && shared.length > 0 ? (
        <div className="stml-relative">
          <label>
            <span>With or against</span>
            <select value={relativeTo} onChange={(event) => setRelativeTo(event.target.value)}>
              <option value="">Pick a team…</option>
              {shared.map((row) => (
                <option key={row.teamKey} value={row.teamKey}>
                  {num(row.teamKey)} ({row.matches} shared)
                </option>
              ))}
            </select>
          </label>
          {relative ? (
            <div className="stml-chips">
              <Chip
                label={`Allied with ${num(relative.teamKey)}`}
                value={relative.with.value != null ? fmt(relative.with.value) : notEnough}
                hint={`${relative.with.matches} match${relative.with.matches === 1 ? "" : "es"}; needs ${MIN_SUMMARY_MATCHES}`}
              />
              <Chip
                label={`Against ${num(relative.teamKey)}`}
                value={relative.against.value != null ? fmt(relative.against.value) : notEnough}
                hint={`${relative.against.matches} match${relative.against.matches === 1 ? "" : "es"}; needs ${MIN_SUMMARY_MATCHES}`}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="stml-scroll" role="region" aria-label="Matches" tabIndex={0}>
        <table className="stml-table">
          <thead>
            <tr>
              <th scope="col">Match</th>
              <th scope="col">Alliance</th>
              <th scope="col">With</th>
              <th scope="col">Against</th>
              <th scope="col">
                Official <small>(alliance)</small>
              </th>
              <th scope="col">
                Total <small>(our scouts)</small>
              </th>
              {view.fields.map((field) => (
                <th key={field.key} scope="col">
                  {field.label} <small>(our scouts)</small>
                </th>
              ))}
              <th scope="col">Notes</th>
              <th scope="col">Video</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.matchKey} className={row.alliance ?? undefined}>
                <th scope="row">{row.label}</th>
                <td>
                  <span className={`stml-dot ${row.alliance ?? "none"}`} aria-hidden="true" />
                  {row.alliance === "red" ? "Red" : row.alliance === "blue" ? "Blue" : "Not on schedule"}
                </td>
                <td>{row.partners.length ? row.partners.map(num).join(" · ") : "—"}</td>
                <td>{row.opponents.length ? row.opponents.map(num).join(" · ") : "—"}</td>
                <td>
                  {row.official ? (
                    <span className={`stml-result ${row.official.result.toLowerCase()}`}>
                      {row.official.result} {row.official.us}–{row.official.them}
                    </span>
                  ) : (
                    <span className="stml-muted">not posted</span>
                  )}
                </td>
                <td>
                  {row.observed.entries === 0 ? (
                    <span className="stml-muted">not scouted</span>
                  ) : (
                    <>
                      {fmt(row.observed.total)}
                      {row.observed.entries > 1 ? <small className="stml-muted"> ×{row.observed.entries}</small> : null}
                    </>
                  )}
                </td>
                {view.fields.map((field) => (
                  <td key={field.key}>{row.observed.entries ? fmt(row.observed.fields[field.key]) : ""}</td>
                ))}
                <td className="stml-notes">{row.notes.length ? row.notes.join(" · ") : ""}</td>
                <td>
                  {row.video ? (
                    <a
                      href={row.video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={row.video.source === "tba" ? "Official match video" : "Video your team saved"}
                    >
                      ▶
                    </a>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="stml-foot">
        {MEDIA_ENABLED ? (
          <>
            <a href={withOrgHref("/match-video-index", orgId)}>Add a video link</a>
            {" · "}
          </>
        ) : null}
        <a href={withOrgHref("/match-notes-timeline", orgId)}>Add a match note</a>
      </p>
    </section>
  );
}
