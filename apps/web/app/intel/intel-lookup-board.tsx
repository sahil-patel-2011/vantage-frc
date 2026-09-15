"use client";

import { useState } from "react";
import {
  buildLookupCards,
  lookupCardVisible,
  type EventRatingRow,
  type LookupCard,
  type LookupFieldStats,
  type LovatLookupMetricId,
  type ScoutAverageRow,
  type ScoutContextPhase,
} from "../../lib/intel/lovat-lookup";
import { IntelLookupNotes } from "./intel-lookup-notes";

function Spark({ path }: { path: string }) {
  return (
    <svg className="intel-spark" viewBox="0 0 72 28" aria-hidden="true" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LookupTile({ card }: { card: LookupCard }) {
  return (
    <article className="intel-lookup-tile">
      <span className="intel-lookup-source">{card.source === "event" ? "Event" : "Our scouting"}</span>
      <span className="intel-lookup-label">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`intel-vs intel-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {card.contribution != null ? (
        <small className="intel-lookup-share">{Math.round(card.contribution * 100)}% of this event</small>
      ) : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : <span className="intel-spark-slot" aria-hidden="true" />}
    </article>
  );
}

function LookupLane({
  title,
  cards,
  empty,
}: {
  title: string;
  cards: LookupCard[];
  empty: string;
}) {
  return (
    <div className="intel-lookup-lane">
      <h4>{title}</h4>
      {cards.length ? (
        <div className="intel-lookup-grid">
          {cards.map((card) => (
            <LookupTile key={card.id} card={card} />
          ))}
        </div>
      ) : (
        <p className="intel-lookup-empty">{empty}</p>
      )}
    </div>
  );
}

const PHASES: ReadonlyArray<readonly [ScoutContextPhase | "all", string]> = [
  ["all", "All"],
  ["auto", "Auto"],
  ["teleop", "Teleop"],
  ["endgame", "Endgame"],
];

export function IntelLookupBoard({
  orgId,
  teamKey,
  event,
  field,
  scout,
  history,
  series,
}: {
  orgId: string;
  teamKey: string;
  event: EventRatingRow | null;
  field: LookupFieldStats;
  scout?: ScoutAverageRow | null;
  history?: Array<number | null>;
  series?: Partial<Record<LovatLookupMetricId, Array<number | null>>>;
}) {
  const [phase, setPhase] = useState<ScoutContextPhase | "all">("all");
  const cards = buildLookupCards({ teamKey, event, field, scout, history, series });
  const visible = cards.filter((card) => lookupCardVisible(phase, card));
  const eventCards = visible.filter((card) => card.source === "event");
  const scoutCards = visible.filter((card) => card.source === "scout");

  return (
    <section className="intel-lookup-board" aria-label="Compared to this event">
      <header>
        <h3>Compared to this event</h3>
        <p className="app-muted">
          {phase === "all"
            ? "Event ratings use synced numbers. Scout ratings stay blank until this team has real scout rows."
            : "Only the actions this robot can do in this phase. Event standing ratings stay on the board."}
        </p>
        <div className="intel-phase-row" role="group" aria-label="Scout phase">
          {PHASES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={phase === id ? "intel-phase is-on" : "intel-phase"}
              aria-pressed={phase === id}
              onClick={() => setPhase(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="intel-lookup-lanes">
        <LookupLane
          title="Event"
          cards={eventCards}
          empty="Needs setup — no event ratings on file yet."
        />
        <LookupLane
          title="Our scouting"
          cards={scoutCards}
          empty="Needs setup — no scout rows yet for this phase."
        />
      </div>
      <IntelLookupNotes orgId={orgId} teamKey={teamKey} />
    </section>
  );
}
