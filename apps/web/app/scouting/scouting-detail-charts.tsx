"use client";

/**
 * Two charts inside the team detail pane, drawn from data already on the page.
 *
 * The trend line shows whether the last few matches agree with the average —
 * the same `series` the sparkline in the list uses, but at full size with an
 * axis so you can read the numbers. The donut shows where the points come
 * from, the same share the phase bars convey, but as a shape you can compare
 * at a glance.
 *
 * Pure arithmetic, no chart library — works from the offline snapshot.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";

const PHASES = [
  { key: "auto", label: "Auto", value: (p: ScoutedTeamProfile) => p.meanAuto, color: "var(--chart-phase-auto)" },
  { key: "teleop", label: "Teleop", value: (p: ScoutedTeamProfile) => p.meanTeleop, color: "var(--chart-phase-teleop)" },
  { key: "endgame", label: "Endgame", value: (p: ScoutedTeamProfile) => p.meanEndgame, color: "var(--chart-phase-endgame)" },
] as const;

/* ---- Trend line ---------------------------------------------------------- */

const TREND_W = 280;
const TREND_H = 96;
const TREND_PAD = { top: 8, right: 6, bottom: 18, left: 22 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = value > 100 ? 20 : value > 40 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function trendPath(series: readonly number[], max: number): string {
  const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right;
  const plotH = TREND_H - TREND_PAD.top - TREND_PAD.bottom;
  const step = series.length > 1 ? plotW / (series.length - 1) : 0;
  return series
    .map((value, index) => {
      const x = TREND_PAD.left + index * step;
      const y = TREND_PAD.top + plotH - (Math.max(value, 0) / max) * plotH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function TrendChart({ profile }: { profile: ScoutedTeamProfile }) {
  const series = profile.series;
  if (series.length < 2) {
    return <p className="sdc-empty">Not enough matches to draw a trend yet.</p>;
  }

  const max = niceMax(Math.max(...series, 1));
  const plotW = TREND_W - TREND_PAD.left - TREND_PAD.right;
  const plotH = TREND_H - TREND_PAD.top - TREND_PAD.bottom;
  const step = series.length > 1 ? plotW / (series.length - 1) : 0;

  const avg = series.reduce((sum, v) => sum + v, 0) / series.length;
  const avgY = TREND_PAD.top + plotH - (Math.max(avg, 0) / max) * plotH;

  const last = series[series.length - 1]!;
  const lastX = TREND_PAD.left + (series.length - 1) * step;
  const lastY = TREND_PAD.top + plotH - (Math.max(last, 0) / max) * plotH;

  // Y-axis ticks: 0, mid, max
  const ticks = [0, max / 2, max];

  return (
    <svg
      className="sdc-trend"
      viewBox={`0 0 ${TREND_W} ${TREND_H}`}
      role="img"
      aria-label={`Match by match: ${series.join(", ")}`}
    >
      {ticks.map((tick) => {
        const y = TREND_PAD.top + plotH - (tick / max) * plotH;
        return (
          <g key={tick}>
            <line
              className="sdc-trend-grid"
              x1={TREND_PAD.left}
              x2={TREND_W - TREND_PAD.right}
              y1={y}
              y2={y}
            />
            <text
              className="sdc-trend-axis"
              x={TREND_PAD.left - 4}
              y={y + 3}
              textAnchor="end"
            >
              {Math.round(tick)}
            </text>
          </g>
        );
      })}

      {/* Average reference line */}
      <line
        className="sdc-trend-avg"
        x1={TREND_PAD.left}
        x2={TREND_W - TREND_PAD.right}
        y1={avgY}
        y2={avgY}
        strokeDasharray="3 3"
      />

      {/* Area fill under the line */}
      <path
        className="sdc-trend-area"
        d={`${trendPath(series, max)} L${(TREND_PAD.left + (series.length - 1) * step).toFixed(1)} ${(TREND_PAD.top + plotH).toFixed(1)} L${TREND_PAD.left.toFixed(1)} ${(TREND_PAD.top + plotH).toFixed(1)} Z`}
      />

      {/* The trend line itself */}
      <path
        className="sdc-trend-line"
        d={trendPath(series, max)}
        pathLength={1}
      />

      {/* End-point marker */}
      <circle
        className="sdc-trend-dot"
        cx={lastX}
        cy={lastY}
        r={3}
      />

      {/* X-axis labels */}
      <text className="sdc-trend-axis" x={TREND_PAD.left} y={TREND_H - 4}>
        M1
      </text>
      <text className="sdc-trend-axis" x={TREND_W - TREND_PAD.right} y={TREND_H - 4} textAnchor="end">
        M{series.length}
      </text>
    </svg>
  );
}

/* ---- Phase donut --------------------------------------------------------- */

const DONUT_R = 38;
const DONUT_STROKE = 14;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

function polarArc(start: number, end: number): string {
  // Convert percentage [0,1] to SVG arc path on a circle centered at (50,50).
  const startAngle = start * 2 * Math.PI - Math.PI / 2;
  const endAngle = end * 2 * Math.PI - Math.PI / 2;
  const x1 = 50 + DONUT_R * Math.cos(startAngle);
  const y1 = 50 + DONUT_R * Math.sin(startAngle);
  const x2 = 50 + DONUT_R * Math.cos(endAngle);
  const y2 = 50 + DONUT_R * Math.sin(endAngle);
  const largeArc = end - start > 0.5 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${DONUT_R} ${DONUT_R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function PhaseDonut({ profile }: { profile: ScoutedTeamProfile }) {
  const parts = PHASES.map((phase) => ({ ...phase, raw: Math.max(0, phase.value(profile)) }));
  const total = parts.reduce((sum, part) => sum + part.raw, 0) || 1;
  const shares = parts.map((part) => part.raw / total);

  let cumulative = 0;
  const arcs = shares.map((share, index) => {
    const start = cumulative;
    const end = cumulative + share;
    cumulative = end;
    return { ...parts[index]!, share, start, end, path: share > 0 ? polarArc(start, end) : "" };
  });

  return (
    <div className="sdc-donut-wrap">
      <svg className="sdc-donut" viewBox="0 0 100 100" role="img" aria-label="Points by phase">
        <circle className="sdc-donut-track" cx={50} cy={50} r={DONUT_R} fill="none" strokeWidth={DONUT_STROKE} />
        {arcs.map((arc) => (
          <path
            key={arc.key}
            className="sdc-donut-slice"
            d={arc.path}
            fill="none"
            strokeWidth={DONUT_STROKE}
            style={{ stroke: arc.color }}
          >
            <title>{`${arc.label}: ${arc.raw.toFixed(1)} pts (${Math.round(arc.share * 100)}%)`}</title>
          </path>
        ))}
        <text className="sdc-donut-center" x={50} y={48} textAnchor="middle">
          {profile.shrunkTotal.toFixed(1)}
        </text>
        <text className="sdc-donut-sub" x={50} y={60} textAnchor="middle">
          per match
        </text>
      </svg>
      <ul className="sdc-donut-legend">
        {arcs.map((arc) => (
          <li key={arc.key}>
            <span className="sdc-donut-swatch" style={{ background: arc.color }} />
            <span className="sdc-donut-label">{arc.label}</span>
            <span className="sdc-donut-value">{arc.raw.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---- Public component ---------------------------------------------------- */

export function ScoutingDetailCharts({ profile }: { profile: ScoutedTeamProfile }) {
  return (
    <div className="sdc">
      <figure className="sdc-chart">
        <figcaption>
          Match trend <span>total points, in order</span>
        </figcaption>
        <TrendChart profile={profile} />
      </figure>
      <figure className="sdc-chart">
        <figcaption>
          Points by phase <span>share of average</span>
        </figcaption>
        <PhaseDonut profile={profile} />
      </figure>
    </div>
  );
}
