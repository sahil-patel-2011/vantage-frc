"use client";

import { useMemo, useState } from "react";
import type { Bootstrap } from "../../scouting/scouting-model";
import { scoutedRobots } from "../../scouting/scouting-model";
import {
  matchCard,
  matchLabel,
  matchOpenForScouting,
  nextMatchIndex,
  orderedSchedule,
} from "../../../lib/scouting/next-match";
import { robotStation, stationLabel } from "../../../lib/scouting/scout-context";

export type QuickTarget = { matchKey: string; teamKey: string };

function timeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Which robot to watch. Your assigned robots first, like a scouting lead's schedule;
 * then the match that is up now with all six robots; then, for a match the schedule does
 * not have, a match number and a team number.
 */
export function QuickScoutPicker({
  data,
  savedHere,
  resume,
  onPick,
}: {
  data: Bootstrap;
  savedHere: QuickTarget[];
  resume: (QuickTarget & { label: string }) | null;
  onPick(target: QuickTarget): void;
}) {
  const schedule = useMemo(() => orderedSchedule(data.matches ?? []), [data.matches]);
  const scouted = useMemo(
    () => [...scoutedRobots(data), ...savedHere],
    [data, savedHere],
  );
  const done = (matchKey: string, teamKey: string) =>
    scouted.some((entry) => entry.matchKey === matchKey && entry.teamKey === teamKey);

  const mine = useMemo(() => {
    const now = Date.now();
    return (data.assignments ?? [])
      .map((assignment) => ({ assignment, match: schedule.find((match) => match.matchKey === assignment.matchKey) }))
      .filter(({ match }) => !match || matchOpenForScouting(match, schedule, now))
      .sort((a, b) => schedule.indexOf(a.match!) - schedule.indexOf(b.match!));
  }, [data.assignments, schedule]);

  const startIndex = useMemo(
    () => nextMatchIndex(schedule, scouted, data.assignments ?? []),
    [schedule, scouted, data.assignments],
  );
  const [index, setIndex] = useState<number | null>(null);
  const shown = index ?? startIndex;
  const card = shown >= 0 ? matchCard(schedule, shown, scouted, data.assignments ?? []) : null;

  const [byHandMatch, setByHandMatch] = useState("");
  const [byHandTeam, setByHandTeam] = useState("");
  const byHandMatchKey = /^\d{1,3}$/.test(byHandMatch.trim()) && data.eventKey ? `${data.eventKey}_qm${Number(byHandMatch.trim())}` : null;
  const byHandTeamKey = /^\d{1,5}$/.test(byHandTeam.trim()) ? `frc${Number(byHandTeam.trim())}` : null;

  return (
    <div className="qs-picker">
      {resume ? (
        <button type="button" className="qs-resume" onClick={() => onPick(resume)}>
          <span>Pick up where you left off</span>
          <strong>{resume.label}</strong>
          <span aria-hidden="true" className="qs-chevron">›</span>
        </button>
      ) : null}

      {mine.length > 0 ? (
        <section className="qs-section" aria-labelledby="qs-mine">
          <h2 id="qs-mine">Your robots</h2>
          <ul className="qs-list">
            {mine.slice(0, 8).map(({ assignment, match }) => {
              const station = stationLabel(robotStation(match, assignment.teamKey));
              const finished = done(assignment.matchKey, assignment.teamKey);
              const when = timeLabel(match?.matchTime);
              return (
                <li key={`${assignment.matchKey}|${assignment.teamKey}`}>
                  <button
                    type="button"
                    className={`qs-row${finished ? " is-done" : ""}`}
                    onClick={() => onPick({ matchKey: assignment.matchKey, teamKey: assignment.teamKey })}
                  >
                    <span className={`qs-dot ${station?.startsWith("Blue") ? "is-blue" : station ? "is-red" : ""}`} aria-hidden="true" />
                    <span className="qs-row-main">
                      <strong>{assignment.teamKey.replace(/^frc/, "")}</strong>
                      <span>
                        {match ? matchLabel(match) : assignment.matchKey}
                        {station ? ` · ${station}` : ""}
                        {when ? ` · ${when}` : ""}
                      </span>
                    </span>
                    <span className="qs-row-end">{finished ? "Done" : <span aria-hidden="true" className="qs-chevron">›</span>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {card ? (
        <section className="qs-section" aria-labelledby="qs-match">
          <div className="qs-match-head">
            <button
              type="button"
              className="qs-step"
              aria-label="Previous match"
              disabled={card.index <= 0}
              onClick={() => setIndex(Math.max(0, card.index - 1))}
            >
              ‹
            </button>
            <h2 id="qs-match">
              {card.label}
              {timeLabel(card.match.matchTime) ? <small>{timeLabel(card.match.matchTime)}</small> : null}
            </h2>
            <button
              type="button"
              className="qs-step"
              aria-label="Next match"
              disabled={card.index >= card.total - 1}
              onClick={() => setIndex(Math.min(card.total - 1, card.index + 1))}
            >
              ›
            </button>
          </div>
          <div className="qs-robots" role="group" aria-label={`Robots in ${card.label}`}>
            {card.robots.map((robot) => (
              <button
                key={robot.teamKey}
                type="button"
                className={`qs-robot is-${robot.alliance}${robot.scouted ? " is-done" : ""}${robot.assignedToYou ? " is-mine" : ""}`}
                onClick={() => onPick({ matchKey: card.match.matchKey, teamKey: robot.teamKey })}
                aria-label={`Scout ${robot.teamNumber}, ${robot.alliance} ${robot.station}${robot.assignedToYou ? ", your robot" : ""}${robot.scouted ? ", already scouted" : ""}`}
              >
                <strong>{robot.teamNumber}</strong>
                <small>
                  {robot.alliance === "red" ? "Red" : "Blue"} {robot.station}
                  {robot.assignedToYou ? " · Yours" : robot.scouted ? " · Done" : ""}
                </small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <details className="qs-section qs-byhand" open={!card && mine.length === 0}>
        <summary>Not on the schedule?</summary>
        <form
          className="qs-byhand-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (byHandMatchKey && byHandTeamKey) onPick({ matchKey: byHandMatchKey, teamKey: byHandTeamKey });
          }}
        >
          <label>
            <span>Qualification match</span>
            <input inputMode="numeric" pattern="[0-9]*" value={byHandMatch} onChange={(event) => setByHandMatch(event.target.value)} placeholder="12" />
          </label>
          <label>
            <span>Team number</span>
            <input inputMode="numeric" pattern="[0-9]*" value={byHandTeam} onChange={(event) => setByHandTeam(event.target.value)} placeholder="254" />
          </label>
          <button type="submit" className="qs-primary" disabled={!byHandMatchKey || !byHandTeamKey}>
            Scout this robot
          </button>
        </form>
        <p className="qs-fineprint">Use your robot list when you can: a mistyped match cannot be matched to the schedule.</p>
      </details>
    </div>
  );
}
