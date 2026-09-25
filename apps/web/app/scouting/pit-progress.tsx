"use client";

import { useEffect, useState } from "react";

type RosterTeam = { teamNumber: number; nickname: string | null; pitScouted?: number };

/**
 * "3 of 24 teams visited" and a chip for each team still to visit, above the pit form. The Pit
 * tab was a blank team-number box that did not say which pits were left; the Scouting app's home
 * already showed this. A chip fills the team in. Hidden until the roster says what it knows.
 */
export function PitProgress({
  orgId,
  teamKey,
  onTeamKey,
}: {
  orgId: string | null | undefined;
  teamKey: string;
  onTeamKey: (teamKey: string) => void;
}) {
  const [teams, setTeams] = useState<RosterTeam[] | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    void fetch(`/api/intel/teams?orgId=${encodeURIComponent(orgId)}&q=`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { roster?: RosterTeam[] } | null) => {
        if (active && Array.isArray(body?.roster)) setTeams(body!.roster);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [orgId]);

  if (!teams?.length || !teams.some((team) => typeof team.pitScouted === "number")) return null;
  const missing = teams.filter((team) => (team.pitScouted ?? 0) === 0);
  const visited = teams.length - missing.length;

  return (
    <section className="pit-progress" aria-label="Pit visits">
      <header>
        <strong>
          {visited} of {teams.length} teams visited
        </strong>
        <span className="pit-progress-meter" aria-hidden="true">
          <i style={{ width: `${Math.round((visited / teams.length) * 100)}%` }} />
        </span>
      </header>
      {missing.length ? (
        <ul>
          {missing.slice(0, 16).map((team) => {
            const key = `frc${team.teamNumber}`;
            return (
              <li key={team.teamNumber}>
                <button
                  type="button"
                  aria-pressed={teamKey === key}
                  aria-label={`Pit scout team ${team.teamNumber}${team.nickname ? `, ${team.nickname}` : ""}`}
                  onClick={() => onTeamKey(key)}
                >
                  {team.teamNumber}
                </button>
              </li>
            );
          })}
          {missing.length > 16 ? <li className="pit-progress-more">+{missing.length - 16} more</li> : null}
        </ul>
      ) : (
        <p className="app-muted">Every team at this event has a pit report.</p>
      )}
    </section>
  );
}
