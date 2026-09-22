"use client";

import { Panel } from "../../components/ui";
import {
  buildLookupCards,
  lookupCardsWithValues,
  ordinalPercentile,
  type EventRatingRow,
  type LookupCard,
  type LookupFieldStats,
  type ScoutAverageRow,
} from "../../lib/intel/lovat-lookup";

function Spark({ path }: { path: string }) {
  return (
    <svg className="intel-spark" viewBox="0 0 72 28" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Where the team sits in this event's field. The track is the field, the tick
 * is the event average, the marker is this team. Drawn only when we have a
 * real percentile — with one team at an event there is no field, and a bar
 * parked at halfway would be a number nobody measured.
 */
function FieldBar({ percentile, tone }: { percentile: number; tone: string }) {
  const ordinal = ordinalPercentile(percentile);
  const pct = `${Math.round(percentile * 100)}%`;
  return (
    <div
      className={`intel-fieldbar intel-fieldbar-${tone}`}
      role="img"
      aria-label={`${ordinal} percentile at this event`}
    >
      <div className="intel-fieldbar-track">
        <span className="intel-fieldbar-fill" style={{ width: pct }} />
        <span className="intel-fieldbar-mean" aria-hidden="true" />
        <span className="intel-fieldbar-dot" style={{ left: pct }} aria-hidden="true" />
      </div>
      <small className="app-muted" aria-hidden="true">
        Better than {Math.round(percentile * 100)}% of this event
      </small>
    </div>
  );
}

function LookupTile({ card }: { card: LookupCard }) {
  return (
    <Panel className="intel-lookup-tile motion-tile" style={{ minHeight: "auto" }}>
      <span className="app-muted">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`intel-vs intel-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {card.percentile != null ? (
        <FieldBar percentile={card.percentile} tone={card.compare.tone} />
      ) : null}
      {card.contribution != null ? (
        // Was "142% of this event", which sat directly under "87th of this
        // event" and read as the same measurement twice. A multiple of the
        // average is what this number actually is.
        <small className="app-muted">{card.contribution.toFixed(1)}× the event average</small>
      ) : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : null}
      <em className="app-muted">{card.detail}</em>
    </Panel>
  );
}

export function IntelLookupBoard({
  teamKey,
  event,
  field,
  scout,
  history,
}: {
  teamKey: string;
  event: EventRatingRow | null;
  field: LookupFieldStats;
  scout?: ScoutAverageRow | null;
  history?: Array<number | null>;
}) {
  const all = buildLookupCards({ teamKey, event, field, scout, history });
  // A wall of "—" tiles buried the six numbers that existed. Show what is on
  // file; say in one line how many were left out and why.
  const cards = lookupCardsWithValues(all);
  const hidden = all.length - cards.length;
  if (cards.length === 0) {
    return (
      <section className="intel-lookup-board" aria-label="Compared to this event">
        <header>
          <h3>Compared to this event</h3>
          <p className="app-muted">No event ratings synced for this team yet.</p>
        </header>
      </section>
    );
  }
  return (
    <section className="intel-lookup-board" aria-label="Compared to this event">
      <header>
        <h3>Compared to this event</h3>
        <p className="app-muted">
          Synced event ratings, placed against every team at this event.
          {hidden > 0 ? ` ${hidden} more stay hidden until there is data for them.` : ""}
        </p>
      </header>
      <div className="intel-lookup-grid">
        {cards.map((card) => (
          <LookupTile key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
