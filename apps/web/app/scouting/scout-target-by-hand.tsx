"use client";

import { useEffect, useState } from "react";
import { Button, FormRow } from "../../components/ui";
import {
  ASSIGNMENTS_ARE_SUGGESTIONS_COPY,
  COMP_LEVELS,
  groupScoutTargets,
  NO_SCHEDULE_COPY,
  describeMatchKey,
  manualMatchKey,
  normalizeTeamKey,
  type CompLevel,
} from "../../lib/scouting/scout-target";

const COMP_LABEL: Record<CompLevel, string> = {
  qm: "Qualification",
  qf: "Quarterfinal",
  sf: "Semifinal",
  f: "Final",
};

/**
 * Pit scouting asks for a team number, the same way match scouting does.
 *
 * The reference table stores `frc254`. Leaving the typed digits as the key
 * makes the save fail the team reference, after the scout already thinks it
 * was recorded.
 */
export function PitTeamField({
  teamKey,
  onTeamKey,
}: {
  teamKey: string;
  onTeamKey: (teamKey: string) => void;
}) {
  const [draft, setDraft] = useState(() => teamKey.replace(/^frc/i, ""));
  const normalized = normalizeTeamKey(draft);
  const problem = draft.trim() && !normalized ? "That is not a team number." : null;

  useEffect(() => {
    if (!teamKey) return;
    if (normalizeTeamKey(draft) === teamKey) return;
    setDraft(teamKey.replace(/^frc/i, ""));
  }, [teamKey, draft]);

  return (
    <div className="scout-by-hand">
      <label>
        Team number
        <input
          inputMode="numeric"
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            onTeamKey(normalizeTeamKey(next) ?? "");
          }}
          placeholder="Team #"
          aria-invalid={Boolean(problem)}
        />
      </label>
      {problem ? (
        <p className="scout-by-hand-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Scouting a robot by typing its number.
 *
 * The schedule is a convenience, not a precondition. At an offseason event
 * there is no synced schedule at all, and on the first morning of any event
 * there is not one yet — before this, an empty dropdown meant match scouting
 * was simply impossible. It is also how someone records a robot two fields over
 * that nobody assigned them.
 *
 * Opens by default when there is no schedule, because then it is the only way
 * through; folds away when there is one, because then it is the exception.
 */
export function ScoutTargetByHand({
  eventKey,
  matchKey,
  teamKey,
  startOpen,
  onPick,
}: {
  eventKey: string;
  matchKey: string;
  teamKey: string;
  startOpen: boolean;
  onPick: (matchKey: string, teamKey: string) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [team, setTeam] = useState("");
  const [compLevel, setCompLevel] = useState<CompLevel>("qm");
  const [matchNumber, setMatchNumber] = useState("");

  const normalizedTeam = normalizeTeamKey(team);
  const number = Number(matchNumber);
  const builtMatchKey = manualMatchKey(eventKey, compLevel, number);
  const ready = Boolean(normalizedTeam && builtMatchKey);

  // Say which half is wrong, and only once the person has typed something. An
  // untouched form is not a form full of mistakes.
  const teamProblem = team.trim() && !normalizedTeam ? "That is not a team number." : null;
  const matchProblem =
    matchNumber.trim() && !builtMatchKey
      ? eventKey
        ? "Match numbers run from 1 to 999."
        : "Set an active event first."
      : null;

  if (!open) {
    return (
      <p className="scout-by-hand-toggle">
        <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(true)}>
          Scout a team that isn’t listed
        </Button>
      </p>
    );
  }

  return (
    <div className="scout-by-hand">
      <p className="app-muted">{startOpen ? NO_SCHEDULE_COPY : "Type any team and match."}</p>
      <div className="scout-by-hand-row">
        <label>
          Team number
          <input
            inputMode="numeric"
            value={team}
            onChange={(event) => setTeam(event.target.value)}
            placeholder="Team #"
            aria-invalid={Boolean(teamProblem)}
          />
        </label>
        <label>
          Round
          <select value={compLevel} onChange={(event) => setCompLevel(event.target.value as CompLevel)}>
            {COMP_LEVELS.map((level) => (
              <option key={level} value={level}>
                {COMP_LABEL[level]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Match
          <input
            inputMode="numeric"
            value={matchNumber}
            onChange={(event) => setMatchNumber(event.target.value.replace(/\D/g, "").slice(0, 3))}
            placeholder="7"
            aria-invalid={Boolean(matchProblem)}
          />
        </label>
      </div>
      {teamProblem || matchProblem ? (
        <p className="scout-by-hand-problem" role="alert">
          {[teamProblem, matchProblem].filter(Boolean).join(" ")}
        </p>
      ) : null}
      <div className="scout-by-hand-actions">
        {!startOpen ? (
          <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          type="button"
          disabled={!ready}
          onClick={() => {
            if (normalizedTeam && builtMatchKey) onPick(builtMatchKey, normalizedTeam);
          }}
        >
          Scout this robot
        </Button>
      </div>
      {matchKey && teamKey ? (
        <p className="app-muted scout-by-hand-current">
          Now scouting {teamKey.replace(/^frc/i, "")} in {describeMatchKey(matchKey)}.
        </p>
      ) : null}
    </div>
  );
}

type TargetOption = { matchKey: string; teamKey: string; label: string; assigned?: boolean };

/**
 * Every other way to choose a robot: the whole schedule as a grouped list, and
 * a typed team for anything that is not on it. Under the robot tiles these are
 * folded away; with no schedule they are the only way in, so they show open.
 */
export function ScoutTargetChoices({
  matchOptions,
  hasSchedule,
  eventKey,
  matchKey,
  teamKey,
  onPick,
}: {
  matchOptions: TargetOption[];
  hasSchedule: boolean;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  onPick: (matchKey: string, teamKey: string) => void;
}) {
  return (
    <>
      {matchOptions.length ? (
        <FormRow
          label={hasSchedule ? "Any match on the schedule" : "Who are you scouting?"}
          hint={matchOptions.some((option) => option.assigned) ? ASSIGNMENTS_ARE_SUGGESTIONS_COPY : undefined}
        >
          <select
            value={`${matchKey}|${teamKey}`}
            onChange={(event) => {
              const [match, team] = event.target.value.split("|");
              onPick(match ?? "", team ?? "");
            }}
          >
            <option value="|">Select match and team</option>
            {/* Grouped by match. Flat, a 36-match event is 216 rows in one
                scroll, and the scout is looking for one of them while the
                match they want is starting. */}
            {groupScoutTargets(matchOptions).map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.options.map((option) => (
                  <option key={`${option.matchKey}-${option.teamKey}`} value={`${option.matchKey}|${option.teamKey}`}>
                    {option.assigned ? `★ ${option.label} · yours` : option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FormRow>
      ) : null}

      {/* The only path at an offseason event, and on the first morning of any
          event before the schedule lands. */}
      <ScoutTargetByHand
        eventKey={eventKey}
        matchKey={matchKey}
        teamKey={teamKey}
        startOpen={!matchOptions.length}
        onPick={onPick}
      />
    </>
  );
}
