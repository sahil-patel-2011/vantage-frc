"use client";

import { Panel } from "../../components/ui";
import {
  buildLookupCards,
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

function LookupTile({ card }: { card: LookupCard }) {
  return (
    <Panel className="intel-lookup-tile motion-tile" style={{ minHeight: "auto" }}>
      <span className="app-muted">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`intel-vs intel-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {card.contribution != null ? (
        <small className="app-muted">{Math.round(card.contribution * 100)}% of this event</small>
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
  const cards = buildLookupCards({ teamKey, event, field, scout, history });
  return (
    <section className="intel-lookup-board" aria-label="Compared to this event">
      <header>
        <h3>Compared to this event</h3>
        <p className="app-muted">
          Event ratings use synced numbers. Scout ratings stay blank until this team has real
          scout rows.
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
