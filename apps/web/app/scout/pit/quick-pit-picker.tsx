"use client";

import { useMemo, useState } from "react";
import { askConfirm } from "../../../components/ui";
import type { SummaryRosterTeam } from "../../../lib/scouting/lead-summary";

type PitTeam = SummaryRosterTeam & { visited: boolean };

/** The number is already on the row; a placeholder name ("Team 6925") would say it twice. */
function teamName(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? name : "";
}

/**
 * Which pit next. The teams nobody has visited come first, in number order (the order pits
 * are usually laid out in); visited teams fold away. Typing filters both. A number that is not
 * on the event's list can still be opened, for a team the list has not caught up with, but
 * only after the list and with a confirm: one typo used to add a phantom team to the event.
 */
export function QuickPitPicker({
  teams,
  drafts = new Map(),
  ownTeamNumber = null,
  eventName = null,
  onPick,
}: {
  teams: PitTeam[];
  /** Pit visits started on this phone and not saved yet, by team key ("Draft · 6 of 8"). */
  drafts?: ReadonlyMap<string, string>;
  /** Our own team, which is not on the pit list. */
  ownTeamNumber?: number | null;
  eventName?: string | null;
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
  const typedOwnTeam = typedNumber !== null && typedNumber === ownTeamNumber;

  async function visitOffList(teamNumber: number) {
    const ok = await askConfirm({
      title: typedOwnTeam ? "Visit your own pit?" : `Team ${teamNumber} is not at ${eventName ?? "this event"}`,
      body: typedOwnTeam
        ? "Your drive team already knows this robot, and your own pit visit does not count toward the event’s pits."
        : "Check the number on the pit sign. A visit to a team that is not on the event’s list is kept apart from the event’s pits.",
      confirmLabel: typedOwnTeam ? "Visit anyway" : `Visit ${teamNumber} anyway`,
      tone: "neutral",
    });
    if (ok) onPick({ teamKey: `frc${teamNumber}`, nickname: null });
  }

  const row = (team: PitTeam) => {
    const draft = drafts.get(team.teamKey);
    // The heading already says "Not visited yet"; the second line is for something new.
    const detail = draft ?? (teamName(team) || null);
    return (
      <li key={team.teamKey}>
        <button type="button" className={`qs-row${team.visited ? " is-done" : ""}${draft ? " has-draft" : ""}`} onClick={() => onPick({ teamKey: team.teamKey, nickname: team.nickname })}>
          <span className={`qs-dot${team.visited ? " is-visited" : draft ? " is-draft" : ""}`} aria-hidden="true" />
          <span className="qs-row-main">
            <strong>{team.teamNumber}</strong>
            {detail ? <span>{detail}</span> : null}
          </span>
          <span className="qs-row-end">{team.visited ? "Visited" : <span aria-hidden="true" className="qs-chevron">›</span>}</span>
        </button>
      </li>
    );
  };

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

      {needle && !matches.length ? (
        <p className="qs-message" role="status">
          {typedOwnTeam
            ? `${typedNumber} is your team. Your pit is not on the list to visit.`
            : typedNumber !== null
              ? `No team ${typedNumber} on this event’s list.`
              : `No team at this event matches “${query.trim()}”. Team names may not be loaded yet, so try the number on the pit sign.`}
        </p>
      ) : null}

      {/* Last and quiet, so the half-typed "25" on the way to "254" is never the biggest button. */}
      {typedNumber !== null && needle.length >= (teams.length ? 2 : 1) ? (
        <button type="button" className="qs-secondary qs-offlist" onClick={() => void visitOffList(typedNumber)}>
          {typedOwnTeam ? "Visit your own pit anyway" : `Team ${typedNumber} is not on the list · visit anyway`}
        </button>
      ) : null}

      {!teams.length && typedNumber === null ? (
        <p className="qs-fineprint">The event’s team list has not arrived yet. Type a team number above to visit its pit anyway.</p>
      ) : null}
    </div>
  );
}
