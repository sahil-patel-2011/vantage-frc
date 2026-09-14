"use client";

import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import {
  KERNEL_LABEL,
  PHASE_LABEL,
  WINDOW_LABEL,
  bestEdge,
  boardSections,
  buildDeepReport,
  buildReport,
  deepHeadline,
  deepReasons,
  emptyCopy,
  formatTier,
  formatValue,
  noticeableFocus,
  residualTone,
  setupReasons,
  sortColley,
  studentChrome,
  undominated,
  worstHole,
  zoneBars,
  type MetricCard,
  type SampleRow,
} from "../../../lib/lovat-kit/teleop-last4-path/compute";
import "./board.css";

function Spark({ path }: { path: string }) {
  return (
    <svg className="lk-teleop-last4-path-spark" viewBox="0 0 72 28" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ card }: { card: MetricCard }) {
  return (
    <Panel className="lk-teleop-last4-path-tile motion-tile" style={{ minHeight: "auto" }}>
      <span className="app-muted">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`lk-teleop-last4-path-vs lk-teleop-last4-path-vs-${card.compare.tone}`}>{card.compare.label}</small>
      {card.contribution != null ? (
        <small className="app-muted">{Math.round(card.contribution * 100)}% of this event</small>
      ) : null}
      {card.sparkline ? <Spark path={card.sparkline} /> : null}
      <em className="app-muted">{card.detail}</em>
    </Panel>
  );
}


function DeepMeter({ label, value }: { label: string; value: string }) {
  return (
    <li className="lk-teleop-last4-path-meter">
      <span className="app-muted">{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

function ZoneRow({ label, width, empty }: { label: string; width: number; empty: boolean }) {
  return (
    <li className="lk-teleop-last4-path-zone">
      <span>{label}</span>
      {empty ? (
        <em className="app-muted">Needs setup</em>
      ) : (
        <i className="lk-teleop-last4-path-bar" style={{ width: `${width}%` }} />
      )}
    </li>
  );
}

function DeepBoard({
  report,
}: {
  report: ReturnType<typeof buildDeepReport>;
}) {
  const sections = boardSections(report);
  const zones = zoneBars(report.zones);
  const colley = sortColley(report.colley).slice(0, 8);
  const front = undominated(report.pareto);
  return (
    <div className="lk-teleop-last4-path-deep">
      <p className="app-muted">{deepHeadline(report)}. {noticeableFocus()}</p>
      <ul className="lk-teleop-last4-path-meters">
        {sections.map((section) => (
          <DeepMeter key={section.id} label={section.title} value={section.body} />
        ))}
      </ul>
      <div className="lk-teleop-last4-path-split">
        <Panel className="lk-teleop-last4-path-panel" style={{ minHeight: "auto" }}>
          <h4>Field zones</h4>
          <ul className="lk-teleop-last4-path-zones">
            {zones.map((zone) => (
              <ZoneRow key={zone.label} label={zone.label} width={zone.width} empty={zone.empty} />
            ))}
          </ul>
        </Panel>
        <Panel className="lk-teleop-last4-path-panel" style={{ minHeight: "auto" }}>
          <h4>Colley / residual</h4>
          {colley.length === 0 ? (
            <p className="app-muted">Needs setup — no paired results yet.</p>
          ) : (
            <ol className="lk-teleop-last4-path-colley">
              {colley.map((row) => (
                <li key={row.teamKey}>
                  {row.teamKey} · {formatValue(row.rating, 2)}
                </li>
              ))}
            </ol>
          )}
          <ul className="lk-teleop-last4-path-residual">
            {report.residuals.map((row) => (
              <li key={row.metric} className={`lk-teleop-last4-path-vs lk-teleop-last4-path-vs-${residualTone(row.residual)}`}>
                {row.metric}: {formatValue(row.residual, 2)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel className="lk-teleop-last4-path-panel" style={{ minHeight: "auto" }}>
        <h4>Pareto front</h4>
        {front.length === 0 ? (
          <p className="app-muted">Needs setup — two ratings required.</p>
        ) : (
          <ul className="lk-teleop-last4-path-pareto">
            {front.map((point) => (
              <li key={point.teamKey}>
                {point.teamKey} · {formatValue(point.x, 1)} / {formatValue(point.y, 1)}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ul className="lk-teleop-last4-path-setup">
        {deepReasons(report).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
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
  const deep = buildDeepReport({ teamKey, rows, fieldRows });
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
    <section className="lk-teleop-last4-path-board" aria-label={chrome.event}>
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
      <div className="lk-teleop-last4-path-grid">
        {report.cards.map((card) => (
          <Tile key={card.id} card={card} />
        ))}
      </div>
      <DeepBoard report={deep} />
      {setupReasons(report.cards).length ? (
        <ul className="lk-teleop-last4-path-setup">
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
    <main className="module-page lk-teleop-last4-path-page">
      <PageHeader
        breadcrumbs={`Competition / ${PHASE_LABEL}`}
        title={`${PHASE_LABEL} · ${WINDOW_LABEL}`}
        description={`Lovat-style ${KERNEL_LABEL} for ${PHASE_LABEL.toLowerCase()}. Compared to this event. Needs setup until samples exist.`}
      />
      <LovatKitBoard teamKey="" rows={[]} />
    </main>
  );
}
