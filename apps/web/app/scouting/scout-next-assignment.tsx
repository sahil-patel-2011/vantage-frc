"use client";

import { Button } from "../../components/ui";
import { formatAssignmentLabel, type AssignmentRobot } from "../../lib/scouting/next-assignment";

export function ScoutNextAssignment({
  assignments,
  matchKey,
  teamKey,
  next,
  remaining,
  lineupHref,
  onSelect,
}: {
  assignments: AssignmentRobot[];
  matchKey: string;
  teamKey: string;
  next: AssignmentRobot | null;
  remaining: number;
  lineupHref: string;
  onSelect: (matchKey: string, teamKey: string) => void;
}) {
  const selected =
    matchKey && teamKey
      ? assignments.find((row) => row.matchKey === matchKey && row.teamKey === teamKey)
      : undefined;
  const hero = selected ?? next ?? null;
  const allSaved = assignments.length > 0 && next == null;

  if (!assignments.length) {
    return (
      <div className="scout-next-robot is-empty" role="status">
        <span className="eyebrow">Assigned robot</span>
        <strong>No assigned robot yet</strong>
        <p className="app-muted">
          A lead assigns quals on Lineup. Until then, pick a match and team from the schedule below.
        </p>
        <Button as="a" variant="secondary" href={lineupHref}>
          Open Lineup
        </Button>
      </div>
    );
  }

  return (
    <div className={`scout-next-robot${allSaved ? " is-done" : ""}`}>
      <span className="eyebrow">{allSaved ? "Assigned robots" : selected ? "Scouting" : "Next robot"}</span>
      {hero ? (
        <>
          <strong>{formatAssignmentLabel(hero)}</strong>
          <p className="app-muted">
            {allSaved
              ? "Every assigned robot has a saved report. Open one below to review or rescout."
              : "Fill auto, teleop, endgame, then notes. Save uploads this report; QR is the backup when venue Wi-Fi is down."}
          </p>
        </>
      ) : null}
      {next && selected && (next.matchKey !== matchKey || next.teamKey !== teamKey) ? (
        <Button
          variant="secondary"
          type="button"
          onClick={() => onSelect(next.matchKey, next.teamKey)}
        >
          Scout next: {formatAssignmentLabel(next)}
        </Button>
      ) : null}
      {remaining > 0 ? (
        <small className="app-muted">
          {remaining} assigned robot{remaining === 1 ? "" : "s"} left after this one
        </small>
      ) : null}
      <label className="scout-next-robot-select">
        <span className="app-muted">Your assignments</span>
        <select
          value={matchKey && teamKey ? `${matchKey}|${teamKey}` : "|"}
          onChange={(event) => {
            const [match, team] = event.target.value.split("|");
            onSelect(match ?? "", team ?? "");
          }}
        >
          <option value="|">Select assigned robot</option>
          {assignments.map((assignment) => (
            <option
              key={`${assignment.matchKey}-${assignment.teamKey}`}
              value={`${assignment.matchKey}|${assignment.teamKey}`}
            >
              {formatAssignmentLabel(assignment)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
