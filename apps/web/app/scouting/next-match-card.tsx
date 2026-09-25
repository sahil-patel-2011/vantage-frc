"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Assignment,
  type ScheduleMatch,
  type ScoutedEntry,
  matchCard,
  matchLabel,
  nextMatchIndex,
  orderedSchedule,
  scheduleIsOver,
} from "../../lib/scouting/next-match";
import { fetchProductSession } from "../../lib/nav/product-session";

/**
 * The match a scout is about to watch, with its six robots as big buttons.
 *
 * Opens on your next assignment (or the next match the team has not scouted), so starting
 * a match is one tap instead of scrolling a dropdown from Qual 1. Arrows step through the
 * schedule; a tick marks robots already scouted and a star marks the ones assigned to you.
 */
export function NextMatchCard({
  matches,
  scouted,
  assignments,
  matchKey,
  teamKey,
  onPick,
  onAutoPick,
  myMatchKeys = [],
}: {
  matches: ScheduleMatch[];
  scouted: ScoutedEntry[];
  assignments: Assignment[];
  matchKey: string;
  teamKey: string;
  onPick: (matchKey: string, teamKey: string) => void;
  /** Selects without scrolling the page to the form; falls back to onPick. */
  onAutoPick?: (matchKey: string, teamKey: string) => void;
  /** Matches this scout already has a report for: reopening skips them, as the save flow does. */
  myMatchKeys?: readonly string[];
}) {
  const schedule = useMemo(() => orderedSchedule(matches), [matches]);
  const baseStart = useMemo(() => nextMatchIndex(schedule, scouted, assignments), [schedule, scouted, assignments]);
  // The match picked for you is "Next to scout". It was labelled "Match 34 of 36 · Go to Qual 33",
  // which read as "you are on the wrong match" when Qual 33 only had our own robot left.
  const [autoStart, setAutoStart] = useState<number | null>(null);
  const start = autoStart ?? baseStart;
  const [index, setIndex] = useState(start);

  // Follow a pick made elsewhere (the full list, a QR handoff, "next match" after saving).
  useEffect(() => {
    const picked = schedule.findIndex((match) => match.matchKey === matchKey);
    if (picked >= 0) setIndex(picked);
  }, [matchKey, schedule]);

  useEffect(() => {
    if (!matchKey) setIndex(start);
  }, [start, matchKey]);

  const card = matchCard(schedule, index, scouted, assignments);

  // Our own team number, to leave our robot for last: the drive team is busy playing it.
  const [ownTeamKey, setOwnTeamKey] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    let active = true;
    void fetchProductSession().then((session) => {
      if (!active) return;
      if (session?.teamNumber) setOwnTeamKey(`frc${session.teamNumber}`);
      setSessionChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // "Scout this match — your next robot, one tap" opened on six tiles with none picked. With
  // nothing picked yet, the next robot is picked for you: yours first, then one nobody has
  // scouted, other teams before ours. Tap a different tile to change it.
  // Only our own robot left in a match: the next match with another team open comes first
  // (the save flow skips ours the same way), then ours.
  const autoPick = useMemo(() => {
    if (matchKey || baseStart < 0 || !sessionChecked) return null;
    const watched = new Set(myMatchKeys);
    let ownFallback: { matchKey: string; teamKey: string } | null = null;
    for (let at = baseStart; at < Math.min(schedule.length, baseStart + 6); at += 1) {
      const candidate = matchCard(schedule, at, scouted, assignments);
      if (!candidate?.robots.length || watched.has(candidate.match.matchKey)) continue;
      const mine = candidate.robots.find((robot) => robot.assignedToYou && !robot.scouted);
      if (mine) return { matchKey: candidate.match.matchKey, teamKey: mine.teamKey };
      const open = candidate.robots.filter((robot) => !robot.scouted);
      const other = open.find((robot) => robot.teamKey !== ownTeamKey);
      if (other) return { matchKey: candidate.match.matchKey, teamKey: other.teamKey };
      if (!ownFallback && open[0]) ownFallback = { matchKey: candidate.match.matchKey, teamKey: open[0].teamKey };
    }
    return ownFallback;
  }, [matchKey, baseStart, schedule, scouted, assignments, ownTeamKey, sessionChecked, myMatchKeys]);
  useEffect(() => {
    if (!autoPick) return;
    const at = schedule.findIndex((match) => match.matchKey === autoPick.matchKey);
    if (at >= 0) setAutoStart(at);
    (onAutoPick ?? onPick)(autoPick.matchKey, autoPick.teamKey);
  }, [autoPick, onPick, onAutoPick, schedule]);

  if (!card) return null;

  const step = (delta: number) => setIndex((current) => Math.min(Math.max(current + delta, 0), schedule.length - 1));
  const startLabel = start >= 0 && schedule[start] ? matchLabel(schedule[start]) : null;
  // After the last match there is no "next": the card is for catching up from notes or video.
  const over = scheduleIsOver(schedule);

  // "Up next" read as the team's own next match, which Home and My Day already
  // use for something else. This card is about the next match to *watch*.
  return (
    <section className="next-match" aria-label="Pick the robot to scout">
      <header className="next-match-head">
        <button type="button" className="next-match-step" onClick={() => step(-1)} disabled={index <= 0} aria-label="Previous match">
          ‹
        </button>
        <div>
          <strong>
            {card.label}
            {/* When it is, so a scout knows how long they have. */}
            {matchClock(card.match.matchTime) ? <span className="next-match-time"> · {matchClock(card.match.matchTime)}</span> : null}
          </strong>
          <small>
            {index === start
              ? over
                ? "Every match here is played · catch up from video"
                : "Next to scout"
              : `Match ${index + 1} of ${card.total}`}
            {index !== start && startLabel ? (
              <>
                {" · "}
                <button type="button" className="next-match-jump" onClick={() => setIndex(start)}>
                  Go to {startLabel}
                </button>
              </>
            ) : null}
          </small>
        </div>
        <button
          type="button"
          className="next-match-step"
          onClick={() => step(1)}
          disabled={index >= schedule.length - 1}
          aria-label="Next match"
        >
          ›
        </button>
      </header>
      {card.robots.length ? (
        <div className="next-match-robots">
          {(["red", "blue"] as const).map((alliance) => (
            <div key={alliance} className={`next-match-row ${alliance}`} role="group" aria-label={`${alliance} alliance`}>
              {card.robots
                .filter((robot) => robot.alliance === alliance)
                .map((robot) => {
                  const selected = matchKey === card.match.matchKey && teamKey === robot.teamKey;
                  return (
                    <button
                      key={robot.teamKey}
                      type="button"
                      className={`next-match-robot${selected ? " is-selected" : ""}${robot.scouted ? " is-done" : ""}`}
                      aria-pressed={selected}
                      aria-label={`Scout team ${robot.teamNumber}, ${alliance} ${robot.station}${robot.assignedToYou ? ", assigned to you" : ""}${robot.scouted ? ", already scouted" : ""}`}
                      onClick={() => onPick(card.match.matchKey, robot.teamKey)}
                    >
                      <b>{robot.teamNumber}</b>
                      <small>
                        {robot.assignedToYou ? "★ Yours" : `${alliance === "red" ? "Red" : "Blue"} ${robot.station}`}
                        {robot.scouted ? " · ✓ Done" : ""}
                      </small>
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      ) : (
        <p className="app-muted">The alliances for this match aren&apos;t published yet. Type the team number below.</p>
      )}
    </section>
  );
}

function matchClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? null : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
