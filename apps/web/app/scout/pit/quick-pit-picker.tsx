"use client";

import { useMemo, useState } from "react";
import type { SummaryRosterTeam } from "../../../lib/scouting/lead-summary";

type PitTeam = SummaryRosterTeam & { visited: boolean };

/** The number is already on the row; a placeholder name ("Team 6925") would say it twice. */
function teamName(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? name : "";
}

/**
 * Which pit next. The teams nobody has visited come first, in number order (the order pits
 * are usually laid out in); visited teams fold away. Typing filters both, and a number that
 * is not on the list can still be opened, for a team the event list has not caught up with.
 */
export function QuickPitPicker({
  teams,
  onPick,
}: {
  teams: PitTeam[];
  onPick(team: { teamKey: string; nickname: string | null }): void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? teams.filter((team) => String(team.teamNumber).startsWith(needle) || (team.nickname ?? "").toLowerCase().includes(needle))
        : teams,
    [teams, needle],
  );
  const todo = matches.filter((team) => !team.visited);
  const done = matches.filter((team) => team.visited);
  const typedNumber = /^\d{1,5}$/.test(needle) && !teams.some((team) => String(team.teamNumber) === needle) ? Number(needle) : null;

  const row = (team: PitTeam) => (
    <li key={team.teamKey}>
      <button type="button" className={`qs-row${team.visited ? " is-done" : ""}`} onClick={() => onPick({ teamKey: team.teamKey, nickname: team.nickname })}>
        <span className={`qs-dot${team.visited ? " is-visited" : ""}`} aria-hidden="true" />
        <span className="qs-row-main">
          <strong>{team.teamNumber}</strong>
          <span>{teamName(team) || (team.visited ? "Visited" : "Not visited yet")}</span>
        </span>
        <span className="qs-row-end">{team.visited ? "Visited" : <span aria-hidden="true" className="qs-chevron">›</span>}</span>
      </button>
    </li>
  );

  return (
    <div className="qs-picker">
      <label className="qs-search">
        <span className="sr-only">Find a team</span>
        <input
          type="search"
          inputMode="search"
          placeholder="Find a team by number or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {typedNumber ? (
        <button type="button" className="qs-resume" onClick={() => onPick({ teamKey: `frc${typedNumber}`, nickname: null })}>
          <span>Not on this event’s list</span>
          <strong>Visit team {typedNumber}</strong>
          <span aria-hidden="true" className="qs-chevron">›</span>
        </button>
      ) : null}

      {todo.length ? (
        <section className="qs-section" aria-labelledby="qs-pit-todo">
          <h2 id="qs-pit-todo">Not visited yet · {todo.length}</h2>
          <ul className="qs-list">{todo.map(row)}</ul>
        </section>
      ) : teams.length && !needle ? (
        <p className="qs-message" role="status">Every team at this event has a pit report. Tap a team below to add to it.</p>
      ) : null}

      {done.length ? (
        <details className="qs-section qs-visited" open={Boolean(needle) || todo.length === 0}>
          <summary>Visited · {done.length}</summary>
          <ul className="qs-list">{done.map(row)}</ul>
        </details>
      ) : null}

      {!teams.length && !typedNumber ? (
        <p className="qs-fineprint">The event’s team list has not arrived yet. Type a team number above to visit its pit anyway.</p>
      ) : null}
    </div>
  );
}
