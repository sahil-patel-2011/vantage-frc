"use client";

import { Button } from "../../components/ui";
import { ViewOnlyNote } from "../../components/view-only-note";
import type { LeadSummaryView } from "../../lib/scouting/lead-summary-load";
import { share } from "../../lib/scouting/lead-summary";

type Ready = Extract<LeadSummaryView, { status: "ready" }>;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "just now", "12m ago", "3h ago", else the date: when a scout last saved anything here. */
function lastActive(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The number is already on the chip; a placeholder name ("Team 6925") would say it twice. */
function chipName(team: { teamNumber: number; nickname: string | null }): string {
  const name = team.nickname?.trim() ?? "";
  return name && name.toLowerCase() !== `team ${team.teamNumber}` ? name : "";
}

/**
 * Pits first. Every team at the event needs one pit visit, it can happen before a match is
 * played, and it is what the drive team asks about when an alliance forms. The one primary
 * button walks to the next pit nobody has visited.
 */
export function ScoutHomePit({
  view,
  pitHref,
  primary = true,
  viewOnly = false,
}: {
  view: Ready;
  pitHref: (teamKey?: string) => string;
  primary?: boolean;
  /** View only (0715): the counts, and a note instead of the visit buttons. */
  viewOnly?: boolean;
}) {
  const { pit } = view;
  const percent = share(pit.visited, pit.total);
  const next = viewOnly ? undefined : pit.notVisited[0];
  return (
    <section className="scout-card scout-card-pit" aria-labelledby="scout-pit-title">
      <header>
        <h2 id="scout-pit-title">Pit scouting</h2>
        <span>{pit.total ? `${pit.visited} of ${pit.total} visited` : "No teams listed yet"}</span>
      </header>
      {pit.total ? (
        <span className="scout-home-meter" aria-hidden="true">
          <i style={{ width: `${percent ?? 0}%` }} />
        </span>
      ) : null}
      {next ? (
        <>
          <Button as="a" variant={primary ? "primary" : "secondary"} className="scout-home-start" href={pitHref(next.teamKey)}>
            Visit {next.teamNumber}
            {chipName(next) ? ` · ${chipName(next)}` : ""}
          </Button>
          {pit.notVisited.length > 1 ? (
            <ul className="scout-chip-row" aria-label="Pits still to visit">
              {pit.notVisited.slice(1, 9).map((team) => (
                <li key={team.teamKey}>
                  <a href={pitHref(team.teamKey)} aria-label={`Visit team ${team.teamNumber}`}>
                    <strong>{team.teamNumber}</strong>
                    <span>{chipName(team)}</span>
                  </a>
                </li>
              ))}
              {pit.notVisited.length > 9 ? (
                <li>
                  <a href={pitHref()} aria-label={`All ${pit.notVisited.length} pits still to visit`}>
                    <strong>+{pit.notVisited.length - 9}</strong>
                    <span>more</span>
                  </a>
                </li>
              ) : null}
            </ul>
          ) : null}
        </>
      ) : viewOnly ? (
        <ViewOnlyNote />
      ) : pit.total ? (
        <p className="scout-card-note">Every other team at this event has a pit report.</p>
      ) : (
        <p className="scout-card-note">The event’s teams appear here when its schedule syncs. You can still visit a pit by team number.</p>
      )}
      {viewOnly ? null : !next || pit.notVisited.length <= 1 ? (
        <a className="scout-card-link" href={pitHref()}>
          {pit.total ? "All pits" : "Visit a pit"}
        </a>
      ) : null}
    </section>
  );
}

/** Match scouting, second: the robot assigned to you next, and how much of the event is covered. */
export function ScoutHomeMatch({
  view,
  duty,
  matchHref,
  primary = false,
  viewOnly = false,
}: {
  view: Ready | null;
  duty: { teamNumber: string; matchLabel: string; station: string | null; when: string | null } | null;
  matchHref: string;
  /** Your robot is about to play: the match comes before the pits for these few minutes. */
  primary?: boolean;
  /** View only (0715): coverage, and a note instead of the scout button. */
  viewOnly?: boolean;
}) {
  const match = view?.match;
  return (
    <section className="scout-card" aria-labelledby="scout-match-title">
      <header>
        <h2 id="scout-match-title">Match scouting</h2>
        {match && match.playedRobots ? (
          <span>
            {match.playedScouted} of {match.playedRobots} robots scouted
          </span>
        ) : null}
      </header>
      {duty ? (
        <p className="scout-home-duty">
          <span>Your next robot</span>
          <strong>
            {duty.teamNumber} · {duty.matchLabel}
            {duty.station ? ` · ${duty.station}` : ""}
          </strong>
          {duty.when ? <small>{duty.when}</small> : null}
        </p>
      ) : viewOnly ? null : (
        <p className="scout-card-note">Pick any robot in the match that is up next.</p>
      )}
      {viewOnly ? (
        <ViewOnlyNote />
      ) : (
        <Button as="a" variant={primary ? "primary" : "secondary"} href={matchHref}>
          {duty ? `Scout ${duty.teamNumber} in ${duty.matchLabel}` : "Scout a match"}
        </Button>
      )}
    </section>
  );
}

/** What you have done here, for a scout coming back: real counts, and what is still yours to do. */
export function ScoutHomeMe({ view, resume }: { view: Ready; resume: { href: string; label: string } | null }) {
  const { me } = view;
  const total = me.pitReports + me.matchReports;
  if (!total && !me.upcoming && !me.missed && !resume) return null;
  return (
    <section className="scout-card scout-card-me" aria-labelledby="scout-me-title">
      <header>
        <h2 id="scout-me-title">{total ? "Your scouting here" : "Your assignments"}</h2>
      </header>
      <dl className="scout-stat-row">
        <div>
          <dt>Pit visits</dt>
          <dd>{me.pitReports}</dd>
        </div>
        <div>
          <dt>Match reports</dt>
          <dd>{me.matchReports}</dd>
        </div>
        <div>
          <dt>Assigned, still to come</dt>
          <dd>{me.upcoming}</dd>
        </div>
        {me.missed ? (
          <div className="is-warn">
            <dt>Missed</dt>
            <dd>{me.missed}</dd>
          </div>
        ) : null}
        {me.points ? (
          <div>
            <dt>Points{me.rank ? ` · #${me.rank}` : ""}</dt>
            <dd>{me.points}</dd>
          </div>
        ) : null}
      </dl>
      {resume ? (
        <a className="scout-card-link" href={resume.href}>
          Pick up where you left off · {resume.label}
        </a>
      ) : null}
    </section>
  );
}

/**
 * The scouting lead's view: what is covered, what is lost, what can still be fixed, and who
 * is doing it. Played robots nobody scouted are gone; upcoming robots with no scout are the
 * ones to assign now.
 */
export function ScoutHomeLead({ view, orgId, withOrg }: { view: Ready; orgId: string; withOrg: (href: string) => string }) {
  const { pit, match, scouts } = view;
  const tiles = [
    { label: "Pits visited", value: `${pit.visited}/${pit.total}`, detail: pit.total ? `${share(pit.visited, pit.total)}%` : "No teams yet", tone: pit.total && pit.visited < pit.total ? "" : "is-good" },
    { label: "Robots scouted", value: `${match.playedScouted}/${match.playedRobots}`, detail: match.playedMatches ? `in ${plural(match.playedMatches, "played match", "played matches")}` : "No matches played", tone: "" },
    { label: "Missed for good", value: String(match.playedMissed), detail: "played, nobody scouted", tone: match.playedMissed ? "is-warn" : "is-good" },
    { label: "Need a scout", value: String(match.upcomingUnassigned), detail: `of ${match.upcomingRobots} upcoming robots`, tone: match.upcomingUnassigned ? "is-warn" : "is-good" },
  ];
  return (
    <section className="scout-card scout-card-lead" aria-labelledby="scout-lead-title">
      <header>
        <h2 id="scout-lead-title">Scouting lead</h2>
        <a className="scout-card-link" href={withOrg("/scout-coverage-live")}>
          Assign scouts
        </a>
      </header>
      <dl className="scout-lead-tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className={tile.tone}>
            <dt>{tile.label}</dt>
            <dd>{tile.value}</dd>
            <small>{tile.detail}</small>
          </div>
        ))}
      </dl>
      {view.openDisagreements ? (
        <a className="scout-lead-alert" href={withOrg("/scout-disagreements")}>
          {plural(view.openDisagreements, "disagreement")} between scouts to settle
        </a>
      ) : null}
      {scouts.length ? (
        <div className="scout-lead-table" role="table" aria-label="Scouts at this event">
          <div role="row" className="is-head">
            <span role="columnheader">Scout</span>
            <span role="columnheader">Pits</span>
            <span role="columnheader">Matches</span>
            <span role="columnheader">Missed</span>
            <span role="columnheader">Last active</span>
          </div>
          {scouts.map((scout) => (
            <div role="row" key={scout.userId}>
              <span role="cell">{scout.name}</span>
              <span role="cell">{scout.pitReports}</span>
              <span role="cell">{scout.matchReports}</span>
              <span role="cell" className={scout.missed ? "is-warn" : undefined}>
                {scout.missed}
              </span>
              <span role="cell">{scout.lastActiveAt ? lastActive(scout.lastActiveAt) : "Not yet"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="scout-card-note">Nobody has scouted at this event yet. Invite scouts in Team › People, then assign them robots.</p>
      )}
      <nav className="scout-lead-actions" aria-label="Scouting lead tools">
        <a href={withOrg("/scouting/forms")}>Forms</a>
        <a href={withOrg("/scout-disagreements")}>Disagreements</a>
        <a href={withOrg("/scouting/quality")}>Data quality</a>
        <a href={`/api/scouting/export?${new URLSearchParams({ orgId, eventKey: view.eventKey })}`} download>
          Export CSV
        </a>
      </nav>
    </section>
  );
}

/**
 * The points game: who's done the most scouting at this event. Points only come from filed work
 * (10 a match, 15 a pit visit, +5 for covering your own assignment), so the board rewards the
 * reports that make the data good. Hidden until someone has scored.
 */
export function ScoutHomePoints({ view, userId }: { view: Ready; userId: string | null }) {
  const board = view.scouts.filter((row) => row.points > 0).sort((a, b) => b.points - a.points || b.bestStreak - a.bestStreak).slice(0, 8);
  if (!board.length) return null;
  return (
    <section className="scout-card scout-card-points" aria-labelledby="scout-points-title">
      <header>
        <h2 id="scout-points-title">Scout points</h2>
        <p className="app-muted">10 a match, 15 a pit visit, +5 for covering your own assignment.</p>
      </header>
      <ol className="scout-points-board">
        {board.map((row, index) => (
          <li key={row.userId} className={row.userId === userId ? "is-me" : undefined}>
            <span className="scout-points-rank">{index + 1}</span>
            <span className="scout-points-name">{row.userId === userId ? `${row.name} (you)` : row.name}</span>
            <span className="scout-points-detail">{row.bestStreak > 1 ? `${row.bestStreak} in a row` : ""}</span>
            <b>{row.points}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
