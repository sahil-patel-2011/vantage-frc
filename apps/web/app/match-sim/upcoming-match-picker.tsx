"use client";

import { useEffect, useState } from "react";
import type { ScheduleView } from "../../lib/schedule-board";
import { stripFrc } from "../../lib/schedule-board";
import { type UpcomingPick, upcomingMatchPicks } from "../../lib/match-sim/upcoming";

/**
 * One tap per match instead of six typed team numbers. Reads the same schedule the
 * Schedule page shows; with no schedule (no active event, nothing published yet) it
 * renders nothing and the typed form below is the whole page, as before.
 */
export function UpcomingMatchPicker({
  orgId,
  busy,
  onPick,
}: {
  orgId: string | null;
  busy: boolean;
  onPick: (pick: UpcomingPick) => void;
}) {
  const [picks, setPicks] = useState<UpcomingPick[] | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/schedule?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<ScheduleView>) : null))
      .then((view) => {
        if (cancelled || !view || view.status !== "ready") return;
        const teamKey = view.context.teamNumber ? `frc${view.context.teamNumber}` : null;
        setPicks(upcomingMatchPicks(view.matches, teamKey));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!picks || picks.length === 0) return null;

  return (
    <section className="msim-upcoming" aria-label="Upcoming matches">
      <h2>Pick a match</h2>
      <ul>
        {picks.map((pick) => (
          <li key={pick.matchKey}>
            <button
              type="button"
              className={pick.ours ? "is-ours" : undefined}
              disabled={busy}
              onClick={() => onPick(pick)}
              aria-label={`Simulate ${pick.label}${pick.ours ? ", your match" : ""}`}
            >
              <b>{pick.label}</b>
              <span className="msim-upcoming-red">{pick.red.map(stripFrc).join(" ")}</span>
              <span className="msim-upcoming-vs">vs</span>
              <span className="msim-upcoming-blue">{pick.blue.map(stripFrc).join(" ")}</span>
              {pick.redWinPct != null ? (
                <small>
                  {pick.redWinPct >= 0.5
                    ? `Red ${Math.round(pick.redWinPct * 100)}%`
                    : `Blue ${Math.round((1 - pick.redWinPct) * 100)}%`}
                </small>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
