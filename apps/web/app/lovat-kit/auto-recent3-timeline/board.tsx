"use client";

import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import {
  KERNEL_LABEL,
  PHASE_LABEL,
  WINDOW_LABEL,
  bestEdge,
  buildReport,
  emptyCopy,
  setupReasons,
  studentChrome,
  worstHole,
  type MetricCard,
  type SampleRow,
} from "../../../lib/lovat-kit/auto-recent3-timeline/compute";
import "./board.css";

function Spark({ path }: { path: string }) {
  return (
    <svg className="lk-auto-recent3-timeline-spark" viewBox="0 0 72 28" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ card }: { card: MetricCard }) {
  return (
    <Panel className="lk-auto-recent3-timeline-tile motion-tile" style={{ minHeight: "auto" }}>
      <span className="app-muted">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`lk-auto-recent3-timeline-vs lk-auto-recent3-timeline-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {card.contribution != null ? (
        <small className="app-muted">{Math.round(card.contribution * 100)}% of this event</small>
      ) : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : null}
      <em className="app-muted">{card.detail}</em>
    </Panel>
  );
}

export function LovatKitBoard({
  teamKey,
  rows,
  fieldRows,
}: {
  teamKey: string;
  rows: SampleRow[];
  fieldRows?: SampleRow[];
}) {
  const report = buildReport({ teamKey, rows, fieldRows });
  const empty = emptyCopy();
  const chrome = studentChrome();
  if (report.summary.known === 0) {
    return (
      <EmptyState
        soft
        badge={empty.badge}
        badgeTone="setup"
        title={empty.title}
        description={empty.description}
      />
    );
  }
  const hole = worstHole(report.cards);
  const edge = bestEdge(report.cards);
  return (
    <section className="lk-auto-recent3-timeline-board" aria-label={chrome.event}>
      <header>
        <h3>{report.headline}</h3>
        <p className="app-muted">
          {PHASE_LABEL} · {WINDOW_LABEL} · {KERNEL_LABEL}. {chrome.event}. Role guess stays blank-safe: {report.role}.
        </p>
      </header>
      {edge ? (
        <p className="app-muted">
          Edge: {edge.label} {edge.display}. {hole ? `Hole: ${hole.label} ${hole.display}.` : ""}
        </p>
      ) : null}
      <div className="lk-auto-recent3-timeline-grid">
        {report.cards.map((card) => (
          <Tile key={card.id} card={card} />
        ))}
      </div>
      {setupReasons(report.cards).length ? (
        <ul className="lk-auto-recent3-timeline-setup">
          {setupReasons(report.cards).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function LovatKitPageClient() {
  return (
    <main className="module-page lk-auto-recent3-timeline-page">
      <PageHeader
        breadcrumbs={`Competition / ${PHASE_LABEL}`}
        title={`${PHASE_LABEL} · ${WINDOW_LABEL}`}
        description={`Lovat-style ${KERNEL_LABEL} for ${PHASE_LABEL.toLowerCase()}. Compared to this event. Needs setup until samples exist.`}
      />
      <LovatKitBoard teamKey="" rows={[]} />
    </main>
  );
}
