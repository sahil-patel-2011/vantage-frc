"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  ownTeamNumber = null,
  initialRoster,
  fallback = null,
}: {
  orgId: string | null | undefined;
  eventKey: string;
  teamKey: string;
  onTeamKey: (teamKey: string) => void;
  /** The team just saved here: counted at once, not after a reload ("Saved 254" beside "1 of 24"). */
  savedTeamKey?: string | null;
  /** Our own robot needs no pit visit; counting it made this "of 24" while Home said "of 23". */
  ownTeamNumber?: number | null;
  initialRoster?: RosterTeam[];
  /** The plain team-number field, shown only when there is no pit list to search. One way to
   * find a team, not two inputs ("Find an unvisited pit" above "Team number"). */
  fallback?: ReactNode;
}) {
  const [teams, setTeams] = useState<RosterTeam[] | null>(null);
  const [savedHere, setSavedHere] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [queuedTeams, setQueuedTeams] = useState<string[]>([]);
  const queueScope = useRef("");
  queueScope.current = `${orgId ?? ""}:${eventKey}`;
  const refreshQueue = useCallback(async () => {
    if (!orgId) return;
    const scope = `${orgId}:${eventKey}`;
    const entries = await listPendingEntries(orgId);
    if (queueScope.current !== scope) return;
    setQueuedTeams(entries.filter(entry => entry.type === "pit" && entry.eventKey === eventKey).map(entry => entry.teamKey));
  }, [orgId, eventKey]);
  useEffect(() => {
    queueScope.current = `${orgId ?? ""}:${eventKey}`;
    return () => { queueScope.current = ""; };
  }, [orgId, eventKey]);
  useScoutQueueRefresh(refreshQueue);
  useEffect(() => {
    if (!savedTeamKey) return;
    setSavedHere((prev) => (prev.includes(savedTeamKey) ? prev : [...prev, savedTeamKey]));
    // A saved visit starts the next one: an empty search, the unvisited pits showing again.
    setQuery("");
  }, [savedTeamKey]);
  useEffect(() => {
    setSavedHere([]); setQueuedTeams([]); setQuery("");
    void refreshQueue();
  }, [orgId, eventKey, refreshQueue]);
  const roster = useMemo(
    () =>
      teams?.filter((team) => team.teamNumber !== ownTeamNumber).map((team) =>
        savedHere.includes(`frc${team.teamNumber}`) || queuedTeams.includes(`frc${team.teamNumber}`) ? { ...team, pitScouted: Math.max(1, team.pitScouted ?? 0) } : team,
      ) ?? null,
    [teams, savedHere, queuedTeams, ownTeamNumber],
  );

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    let liveAccepted = false;
    setTeams(null);
    if (initialRoster?.length) {
      setTeams(initialRoster);
      void saveRoster(orgId, initialRoster, eventKey).catch(() => undefined);
      return () => { active = false; };
    }
    // The saved event roster paints first; the live read replaces it quietly.
    void loadRoster(orgId, eventKey).then(saved => { if (active && !liveAccepted && saved) setTeams(saved.roster); });
    const controller = new AbortController();
    void fetch(`/api/intel/teams?orgId=${encodeURIComponent(orgId)}&q=`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]) })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { roster?: RosterTeam[]; activeEvent?: { eventKey?: string } | null } | null) => {
        if (active && body?.activeEvent?.eventKey === eventKey && Array.isArray(body.roster)) {
          liveAccepted = true;
          setTeams(body!.roster);
          void saveRoster(orgId, body!.roster, eventKey).catch(() => undefined);
        }
      })
      .catch(async () => {
        const saved = await loadRoster(orgId, eventKey);
        if (active && saved) setTeams(saved.roster);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [orgId, eventKey, initialRoster]);

  if (!roster?.length || !roster.some((team) => typeof team.pitScouted === "number")) return <>{fallback}</>;
  const missing = roster.filter((team) => (team.pitScouted ?? 0) === 0);
  const visited = roster.length - missing.length;
  const needle = query.trim().toLowerCase().replace(/^frc/, "");
  // A typed team number that is not an unvisited pit (already visited, or not on the list) still
  // opens: the search box is also the team-number field.
  const typedNumber = /^\d{1,5}$/.test(needle) ? Number(needle) : null;
  const choices = missing.filter(team => !needle || String(team.teamNumber).startsWith(needle) || team.nickname?.toLowerCase().includes(needle))
    .sort((a,b) => a.teamNumber - b.teamNumber);

  return (
    <section className="pit-progress" aria-label="Pit visits">
      <header>
        <strong>
          {visited} of {roster.length} pits visited
        </strong>
        <span className="pit-progress-meter" aria-hidden="true">
          <i style={{ width: `${Math.round((visited / roster.length) * 100)}%` }} />
        </span>
      </header>
      {missing.length ? (
        <>
        <label className="pit-progress-search"><span className="sr-only">Team number or name</span>
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Team number or name" />
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
        {typedNumber != null && !choices.some((team) => team.teamNumber === typedNumber) ? (
          <button
            type="button"
            className="pit-progress-typed"
            aria-pressed={teamKey === `frc${typedNumber}`}
            aria-label={`Pit scout team ${typedNumber}`}
            onClick={() => onTeamKey(`frc${typedNumber}`)}
          >
            Scout team {typedNumber}
          </button>
        ) : null}
        {choices.length === 0 && typedNumber == null ? (
          <p className="app-muted">No unvisited pits match “{query}”. Type a team number to scout it anyway.</p>
        ) : null}
        </>
      ) : (
        <>
          <p className="app-muted">Every team at this event has a pit report.</p>
          {fallback}
        </>
      )}
    </section>
  );
}
