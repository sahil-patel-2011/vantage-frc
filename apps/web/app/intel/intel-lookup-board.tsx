"use client";

import { useEffect, useState } from "react";
import {
  buildLookupCards,
  lookupCardVisible,
  lookupContributionLabel,
  lookupSourceLabel,
  selectedLookupCard,
  type EventRatingRow,
  type LookupCard,
  type LookupFieldStats,
  type LovatLookupMetricId,
  type ScoutAverageRow,
  type ScoutContextPhase,
} from "../../lib/intel/lovat-lookup";
import { Button } from "../../components/ui";
import { IntelLookupNotes } from "./intel-lookup-notes";

function Spark({ path }: { path: string }) {
  return (
    <svg className="intel-spark" viewBox="0 0 72 28" aria-hidden="true" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LookupTile({
  card,
  selected,
  onSelect,
  staggerIndex,
}: {
  card: LookupCard;
  selected: boolean;
  onSelect: (id: LovatLookupMetricId) => void;
  staggerIndex: number | null;
}) {
  const share = lookupContributionLabel(card.contribution);
  const className = [
    "intel-lookup-tile",
    "qol-press",
    "qol-lift",
    selected ? "is-on" : undefined,
    staggerIndex != null ? "qol-stagger-row" : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={className}
      style={staggerIndex != null ? { ["--qol-i" as string]: staggerIndex } : undefined}
      aria-pressed={selected}
      onClick={() => onSelect(card.id)}
    >
      <span className="intel-lookup-source">{lookupSourceLabel(card.source)}</span>
      <span className="intel-lookup-label">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`intel-vs intel-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {share ? <small className="intel-lookup-share">{share}</small> : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : <span className="intel-spark-slot" aria-hidden="true" />}
    </button>
  );
}

function LookupLane({
  title,
  cards,
  empty,
  selectedId,
  onSelect,
}: {
  title: string;
  cards: LookupCard[];
  empty: string;
  selectedId: LovatLookupMetricId | null;
  onSelect: (id: LovatLookupMetricId) => void;
}) {
  return (
    <div className="intel-lookup-lane">
      <h4>{title}</h4>
      {cards.length ? (
        <div className="intel-lookup-grid">
          {cards.map((card, index) => (
            <LookupTile
              key={card.id}
              card={card}
              selected={card.id === selectedId}
              onSelect={onSelect}
              staggerIndex={index < 8 ? index : null}
            />
          ))}
        </div>
      ) : (
        <p className="intel-lookup-empty">{empty}</p>
      )}
    </div>
  );
}

function LookupDetail({ card, onClose }: { card: LookupCard; onClose: () => void }) {
  const share = lookupContributionLabel(card.contribution);
  return (
    <article className="intel-lookup-detail" aria-label={card.label}>
      <header className="intel-lookup-detail-head">
        <div>
          <span className="intel-lookup-source">{lookupSourceLabel(card.source)}</span>
          <h4>{card.label}</h4>
          <strong>{card.display}</strong>
        </div>
        <Button size="sm" variant="secondary" type="button" onClick={onClose}>
          Close
        </Button>
      </header>
      <p className={`intel-vs intel-vs-${card.compare.tone}`}>
        Compared to this event · {card.compare.label}
      </p>
      {share ? <p className="intel-lookup-share">{share}</p> : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : null}
      <p className="app-muted">{card.detail}</p>
    </article>
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
  const [pane, setPane] = useState<"stats" | "notes">("stats");
  const [selectedId, setSelectedId] = useState<LovatLookupMetricId | null>(null);
  const cards = buildLookupCards({ teamKey, event, field, scout, history, series });
  const visible = cards.filter((card) => lookupCardVisible(phase, card));
  const selected = selectedLookupCard(visible, selectedId);
  const eventCards = visible.filter((card) => card.source === "event");
  const scoutCards = visible.filter((card) => card.source === "scout");

  useEffect(() => {
    setSelectedId(null);
  }, [teamKey]);

  useEffect(() => {
    if (!selected) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <section className="intel-lookup-board" aria-label="Compared to this event">
      <header>
        <h3>Compared to this event</h3>
        <p className="app-muted">
          {pane === "notes"
            ? "Shared notes for this lookup. Blank until someone writes one."
            : selected
              ? "One category. Close to return to the grid. Numbers stay the ones on file."
              : phase === "all"
                ? "Event ratings use synced numbers. Scout ratings stay blank until this team has real scout rows."
                : "Only the actions this robot can do in this phase. Event standing ratings stay on the board."}
        </p>
        <div className="intel-lookup-tabs" role="tablist" aria-label="Lookup board">
          <button
            type="button"
            role="tab"
            className={pane === "stats" ? "intel-phase is-on qol-press" : "intel-phase qol-press"}
            aria-selected={pane === "stats"}
            onClick={() => setPane("stats")}
          >
            Stats
          </button>
          <button
            type="button"
            role="tab"
            className={pane === "notes" ? "intel-phase is-on qol-press" : "intel-phase qol-press"}
            aria-selected={pane === "notes"}
            onClick={() => setPane("notes")}
          >
            Notes
          </button>
        </div>
        {pane === "stats" ? (
          <div className="intel-phase-row" role="group" aria-label="Scout phase">
            {PHASES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={phase === id ? "intel-phase is-on qol-press" : "intel-phase qol-press"}
                aria-pressed={phase === id}
                onClick={() => setPhase(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {pane === "notes" ? (
        <IntelLookupNotes orgId={orgId} teamKey={teamKey} />
      ) : selected ? (
        <LookupDetail card={selected} onClose={() => setSelectedId(null)} />
      ) : (
        <div className="intel-lookup-lanes">
          <LookupLane
            title="Event"
            cards={eventCards}
            empty="Needs setup — no event ratings on file yet."
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <LookupLane
            title="Our scouting"
            cards={scoutCards}
            empty="Needs setup — no scout rows yet for this phase."
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      )}
    </section>
  );
}
