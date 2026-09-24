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
}: {
  matches: ScheduleMatch[];
  scouted: ScoutedEntry[];
  assignments: Assignment[];
  matchKey: string;
  teamKey: string;
  onPick: (matchKey: string, teamKey: string) => void;
}) {
  const schedule = useMemo(() => orderedSchedule(matches), [matches]);
  const start = useMemo(() => nextMatchIndex(schedule, scouted, assignments), [schedule, scouted, assignments]);
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
          <strong>{card.label}</strong>
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
