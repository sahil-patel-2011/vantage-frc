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
  buildWideReport,
  wideSections,
  wideReasons,
  formatSlot,
  formatScout,
  buildLovatExactReport,
  lovatExactReasons,
  lovatExactWin,
  type MetricCard,
  type SampleRow,
} from "../../../lib/lovat-kit/auto-recent3-playhead/compute";
import "./board.css";

function Spark({ path }: { path: string }) {
  return (
    <svg className="lk-auto-recent3-playhead-spark" viewBox="0 0 72 28" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ card }: { card: MetricCard }) {
  return (
    <Panel className="lk-auto-recent3-playhead-tile motion-tile" style={{ minHeight: "auto" }}>
      <span className="app-muted">{card.label}</span>
      <strong>{card.display}</strong>
      <small className={`lk-auto-recent3-playhead-vs lk-auto-recent3-playhead-vs-${card.compare.tone}`}>{card.compare.label}</small>
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
    <li className="lk-auto-recent3-playhead-meter">
      <span className="app-muted">{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

function ZoneRow({ label, width, empty }: { label: string; width: number; empty: boolean }) {
  return (
    <li className="lk-auto-recent3-playhead-zone">
      <span>{label}</span>
      {empty ? (
        <em className="app-muted">Needs setup</em>
      ) : (
        <i className="lk-auto-recent3-playhead-bar" style={{ width: `${width}%` }} />
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
    <div className="lk-auto-recent3-playhead-deep">
      <p className="app-muted">{deepHeadline(report)}. {noticeableFocus()}</p>
      <ul className="lk-auto-recent3-playhead-meters">
        {sections.map((section) => (
          <DeepMeter key={section.id} label={section.title} value={section.body} />
        ))}
      </ul>
      <div className="lk-auto-recent3-playhead-split">
        <Panel className="lk-auto-recent3-playhead-panel" style={{ minHeight: "auto" }}>
          <h4>Field zones</h4>
          <ul className="lk-auto-recent3-playhead-zones">
            {zones.map((zone) => (
              <ZoneRow key={zone.label} label={zone.label} width={zone.width} empty={zone.empty} />
            ))}
          </ul>
        </Panel>
        <Panel className="lk-auto-recent3-playhead-panel" style={{ minHeight: "auto" }}>
          <h4>Colley / residual</h4>
          {colley.length === 0 ? (
            <p className="app-muted">Needs setup — no paired results yet.</p>
          ) : (
            <ol className="lk-auto-recent3-playhead-colley">
              {colley.map((row) => (
                <li key={row.teamKey}>
                  {row.teamKey} · {formatValue(row.rating, 2)}
                </li>
              ))}
            </ol>
          )}
          <ul className="lk-auto-recent3-playhead-residual">
            {report.residuals.map((row) => (
              <li key={row.metric} className={`lk-auto-recent3-playhead-vs lk-auto-recent3-playhead-vs-${residualTone(row.residual)}`}>
                {row.metric}: {formatValue(row.residual, 2)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel className="lk-auto-recent3-playhead-panel" style={{ minHeight: "auto" }}>
        <h4>Pareto front</h4>
        {front.length === 0 ? (
          <p className="app-muted">Needs setup — two ratings required.</p>
        ) : (
          <ul className="lk-auto-recent3-playhead-pareto">
            {front.map((point) => (
              <li key={point.teamKey}>
                {point.teamKey} · {formatValue(point.x, 1)} / {formatValue(point.y, 1)}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ul className="lk-auto-recent3-playhead-setup">
        {deepReasons(report).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}


function WideBoard({ report }: { report: ReturnType<typeof buildWideReport> }) {
  const sections = wideSections(report);
  return (
    <div className="lk-auto-recent3-playhead-wide">
      <p className="app-muted">{report.headline}. Hodges–Lehmann and Theil–Sen stay blank until a real series exists.</p>
      <ul className="lk-auto-recent3-playhead-wide-meters">
        {sections.map((section) => (
          <DeepMeter key={section.id} label={section.title} value={section.body} />
        ))}
      </ul>
      <div className="lk-auto-recent3-playhead-split">
        <Panel className="lk-auto-recent3-playhead-panel" style={{ minHeight: "auto" }}>
          <h4>Match slots</h4>
          <ol className="lk-auto-recent3-playhead-slots">
            {report.slots.map((slot) => (
              <li key={slot.index} className={`lk-auto-recent3-playhead-vs lk-auto-recent3-playhead-vs-${slot.tone}`}>{formatSlot(slot)}</li>
            ))}
          </ol>
        </Panel>
        <Panel className="lk-auto-recent3-playhead-panel" style={{ minHeight: "auto" }}>
          <h4>Scout agreement</h4>
          <ul className="lk-auto-recent3-playhead-scouts">
            {report.scouts.map((slice) => (
              <li key={slice.key}>{formatScout(slice)}</li>
            ))}
          </ul>
        </Panel>
      </div>
      <ul className="lk-auto-recent3-playhead-setup">
        {wideReasons(report).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}


function LovatExactBoard({ report }: { report: ReturnType<typeof buildLovatExactReport> }) {
  return (
    <div className="lk-auto-recent3-playhead-lovat">
      <p className="app-muted">{report.headline}. 22 Lovat metrics. Compared to this event. Win% uses Lovat's Φ((0−Δ)/σ).</p>
      {report.win ? (
        <p>Red {Math.round(report.win.redWinPct * 100)}% · Blue {Math.round(report.win.blueWinPct * 100)}% · {report.win.redPredicted}–{report.win.bluePredicted}</p>
      ) : (
        <p className="app-muted">Needs setup — both alliances need a real mean and spread.</p>
      )}
      <p className="app-muted">Pick score {formatValue(report.pick, 2)}. Visible now: {report.visible.join(", ") || "Needs setup"}.</p>
      <div className="lk-auto-recent3-playhead-grid">
        {report.cards.map((card) => (
          <Tile key={card.id} card={{
            id: METRICS[0]!.id,
            label: card.label,
            value: card.value,
            display: card.display,
            compare: card.compare,
            contribution: card.contribution,
            sparkline: card.sparkline,
            sample: card.sample,
            detail: card.detail,
          }} />
        ))}
      </div>
      <ul className="lk-auto-recent3-playhead-setup">
        {lovatExactReasons(report).map((reason) => (
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
    <section className="lk-auto-recent3-playhead-board" aria-label={chrome.event}>
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
      <div className="lk-auto-recent3-playhead-grid">
        {report.cards.map((card) => (
          <Tile key={card.id} card={card} />
        ))}
      </div>
      <DeepBoard report={deep} />
      <WideBoard report={buildWideReport({ teamKey, rows, fieldRows })} />
      <LovatExactBoard report={buildLovatExactReport({ teamKey, rows, fieldRows })} />
      {setupReasons(report.cards).length ? (
        <ul className="lk-auto-recent3-playhead-setup">
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
    <main className="module-page lk-auto-recent3-playhead-page">
      <PageHeader
        breadcrumbs={`Competition / ${PHASE_LABEL}`}
        title={`${PHASE_LABEL} · ${WINDOW_LABEL}`}
        description={`Lovat-style ${KERNEL_LABEL} for ${PHASE_LABEL.toLowerCase()}. Compared to this event. Needs setup until samples exist.`}
      />
      <LovatKitBoard teamKey="" rows={[]} />
    </main>
  );
}
