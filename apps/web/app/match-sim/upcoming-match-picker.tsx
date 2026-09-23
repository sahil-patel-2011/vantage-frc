"use client";

import { useEffect, useState } from "react";
import type { ScheduleView } from "../../lib/schedule-board";
import { stripFrc } from "../../lib/schedule-board";
import { type UpcomingPick, upcomingMatchPicks } from "../../lib/match-sim/upcoming";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

/**
 * One tap per match instead of six typed team numbers. Reads the same schedule the
 * Schedule page shows, and the same offline copy of it: with no signal the list and each
 * match's estimate still show, and the note says a full simulation needs a connection
 * (it runs on the server). With no schedule at all it renders nothing and the typed form
 * below is the whole page.
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
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const show = (view: ScheduleView | null | undefined) => {
      if (cancelled || !view || view.status !== "ready") return;
      const teamKey = view.context.teamNumber ? `frc${view.context.teamNumber}` : null;
      setPicks(upcomingMatchPicks(view.matches, teamKey));
    };
    void (async () => {
      try {
        show((await getFeatureSnapshot<ScheduleView>("schedule", orgId))?.data);
      } catch {
        // No saved copy; the live read below is the only source.
      }
      try {
        const response = await fetch(`/api/schedule?orgId=${encodeURIComponent(orgId)}`);
        if (!response.ok) return;
        const view = (await response.json()) as ScheduleView;
        if (cancelled) return;
        setOffline(false);
        show(view);
        if (view.status === "ready") void putFeatureSnapshot("schedule", orgId, view).catch(() => undefined);
      } catch {
        if (!cancelled) setOffline(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!picks || picks.length === 0) return null;

  return (
    <section className="msim-upcoming" aria-label="Upcoming matches">
      <h2>Pick a match</h2>
      {offline ? (
        <p className="msim-upcoming-note" role="status">
          Offline — these are the schedule&rsquo;s saved estimates. A full simulation runs once you have signal.
        </p>
      ) : null}
      <ul>
        {picks.map((pick) => (
          <li key={pick.matchKey}>
            <button
              type="button"
              className={pick.ours ? "is-ours" : undefined}
              disabled={busy || offline}
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
