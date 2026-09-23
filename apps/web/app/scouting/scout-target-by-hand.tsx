"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import {
  COMP_LEVELS,
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
          placeholder="254"
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
            placeholder="254"
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
