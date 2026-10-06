"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadRoster, saveRoster, type OfflineRosterTeam } from "../../lib/intel/offline-teams";
import { listPendingEntries } from "../../lib/scout-offline";
import { useScoutQueueRefresh } from "../../lib/scouting/use-queue-refresh";

type RosterTeam = OfflineRosterTeam;

/**
 * "3 of 24 teams visited" and a chip for each team still to visit, above the pit form. The Pit
 * tab was a blank team-number box that did not say which pits were left; the Scouting app's home
 * already showed this. A chip fills the team in. Hidden until the roster says what it knows.
 */
export function PitProgress({
  orgId,
  eventKey,
  teamKey,
  onTeamKey,
  savedTeamKey = null,
}: {
  orgId: string | null | undefined;
  eventKey: string;
  teamKey: string;
  onTeamKey: (teamKey: string) => void;
  /** The team just saved here: counted at once, not after a reload ("Saved 254" beside "1 of 24"). */
  savedTeamKey?: string | null;
}) {
  const [teams, setTeams] = useState<RosterTeam[] | null>(null);
  const [savedHere, setSavedHere] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [queuedTeams, setQueuedTeams] = useState<string[]>([]);
  const refreshQueue = useCallback(async () => {
    if (!orgId) return;
    const entries = await listPendingEntries(orgId);
    setQueuedTeams(entries.filter(entry => entry.type === "pit" && entry.eventKey === eventKey).map(entry => entry.teamKey));
  }, [orgId, eventKey]);
  useScoutQueueRefresh(refreshQueue);
  useEffect(() => {
    if (savedTeamKey) setSavedHere((prev) => (prev.includes(savedTeamKey) ? prev : [...prev, savedTeamKey]));
  }, [savedTeamKey]);
  const roster = useMemo(
    () =>
      teams?.map((team) =>
        savedHere.includes(`frc${team.teamNumber}`) || queuedTeams.includes(`frc${team.teamNumber}`) ? { ...team, pitScouted: Math.max(1, team.pitScouted ?? 0) } : team,
      ) ?? null,
    [teams, savedHere, queuedTeams],
  );

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setTeams(null);
    setSavedHere([]);
    setQueuedTeams([]);
    setQuery("");
    void fetch(`/api/intel/teams?orgId=${encodeURIComponent(orgId)}&q=`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { roster?: RosterTeam[] } | null) => {
        if (active && Array.isArray(body?.roster)) {
          setTeams(body!.roster);
          void saveRoster(orgId, body!.roster).catch(() => undefined);
        }
      })
      .catch(async () => {
        const saved = await loadRoster(orgId);
        if (active && saved) setTeams(saved.roster);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  if (!roster?.length || !roster.some((team) => typeof team.pitScouted === "number")) return null;
  const missing = roster.filter((team) => (team.pitScouted ?? 0) === 0);
  const visited = roster.length - missing.length;
  const needle = query.trim().toLowerCase().replace(/^frc/, "");
  const choices = missing.filter(team => !needle || String(team.teamNumber).startsWith(needle) || team.nickname?.toLowerCase().includes(needle))
    .sort((a,b) => a.teamNumber - b.teamNumber);

  return (
    <section className="pit-progress" aria-label="Pit visits">
      <header>
        <strong>
          {visited} of {roster.length} teams visited
        </strong>
        <span className="pit-progress-meter" aria-hidden="true">
          <i style={{ width: `${Math.round((visited / roster.length) * 100)}%` }} />
        </span>
      </header>
      {missing.length ? (
        <>
        <label className="pit-progress-search"><span className="sr-only">Find an unvisited pit</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a team to visit" />
        </label>
        <ul>
          {choices.slice(0, 16).map((team) => {
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
          {choices.length > 16 ? <li className="pit-progress-more">+{choices.length - 16} · search to find them</li> : null}
        </ul>
        {choices.length === 0 ? <p className="app-muted">No unvisited pits match “{query}”. You can still type a team number below.</p> : null}
        </>
      ) : (
        <p className="app-muted">Every team at this event has a pit report.</p>
      )}
    </section>
  );
}
