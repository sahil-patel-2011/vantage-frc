"use client";

/**
 * Split-view comparison: exactly two robots, side by side, every metric
 * lined up so the eye reads across, not down.
 *
 * The existing compare panel stacks up to three cards and is great for a
 * quick glance. This is the deep-dive: a dedicated two-column layout where
 * each metric row mirrors left↔right, overlaid charts make the gap visible,
 * and a verdict line at the bottom says who wins and by how much.
 *
 * Pure arithmetic over profiles already on the page — no request, works
 * offline, matches the teal-slate aesthetic.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
import { phasePointValue, pointValue } from "./scouting-points-display";
import { CONSISTENCY_LABEL } from "@vantage/prediction-strategy";
import "./scouting-split-compare.css";

function teamNumberLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

type Phase = {
  key: "auto" | "teleop" | "endgame";
  label: string;
  value: (p: ScoutedTeamProfile) => number | null;
};

const PHASES: Phase[] = [
  { key: "auto", label: "Auto", value: (p) => phasePointValue(p, "auto") },
  { key: "teleop", label: "Teleop", value: (p) => phasePointValue(p, "teleop") },
  { key: "endgame", label: "Endgame", value: (p) => phasePointValue(p, "endgame") },
];

type MetricRow = {
  label: string;
  left: number | null;
  right: number | null;
  format?: (v: number) => string;
  higherIsBetter: boolean;
};

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function ScoutingSplitCompare({
  left,
  right,
  onClose,
}: {
  left: ScoutedTeamProfile;
  right: ScoutedTeamProfile;
  onClose: () => void;
}) {
  const phaseMax = Math.max(
    1,
    ...PHASES.map((ph) => Math.max(ph.value(left) ?? 0, ph.value(right) ?? 0)),
  );

  const seriesMax = niceMax(
    Math.max(1, ...left.series, ...right.series),
  );

  const metrics: MetricRow[] = [
    { label: "Avg / match", left: left.meanTotal, right: right.meanTotal, higherIsBetter: true },
    { label: "Scored matches", left: left.matches, right: right.matches, higherIsBetter: true },
    { label: "Auto", left: phasePointValue(left, "auto"), right: phasePointValue(right, "auto"), higherIsBetter: true },
    { label: "Teleop", left: phasePointValue(left, "teleop"), right: phasePointValue(right, "teleop"), higherIsBetter: true },
    { label: "Endgame", left: phasePointValue(left, "endgame"), right: phasePointValue(right, "endgame"), higherIsBetter: true },
    { label: "Climb rate", left: left.climbRate, right: right.climbRate, format: pct, higherIsBetter: true },
    { label: "Disabled", left: left.disabledRate, right: right.disabledRate, format: pct, higherIsBetter: false },
    { label: "Defense", left: left.defenseRate, right: right.defenseRate, format: pct, higherIsBetter: true },
  ];

  if (left.percentile != null && right.percentile != null) {
    metrics.push({ label: "Field percentile", left: left.percentile, right: right.percentile, higherIsBetter: true });
  }

  const leftWins = left.meanTotal >= right.meanTotal;
  const gap = Math.abs(left.meanTotal - right.meanTotal);

  return (
    <section className="ssv" aria-label="Split comparison">
      <header className="ssv-head">
        <div className="ssv-title">
          <h3>Head to head</h3>
          <p>{teamNumberLabel(left.teamKey)} vs {teamNumberLabel(right.teamKey)}</p>
        </div>
        <button type="button" className="ssv-close" onClick={onClose} aria-label="Close split view">
          ×
        </button>
      </header>

      {/* Team banners */}
      <div className="ssv-banners">
        <div className="ssv-banner" data-side="left">
          <span className="ssv-banner-team">{teamNumberLabel(left.teamKey)}</span>
          <span className="ssv-banner-score">
            <strong>{left.meanTotal.toFixed(1)}</strong>
            <small>per match</small>
          </span>
          <span className="ssv-banner-tag">{CONSISTENCY_LABEL[left.consistency?.consistency ?? "unknown"]}</span>
        </div>
        <div className="ssv-vs" aria-hidden="true">VS</div>
        <div className="ssv-banner" data-side="right">
          <span className="ssv-banner-team">{teamNumberLabel(right.teamKey)}</span>
          <span className="ssv-banner-score">
            <strong>{right.meanTotal.toFixed(1)}</strong>
            <small>per match</small>
          </span>
          <span className="ssv-banner-tag">{CONSISTENCY_LABEL[right.consistency?.consistency ?? "unknown"]}</span>
        </div>
      </div>

      {/* Phase comparison bars — mirrored outward from center */}
      <div className="ssv-phase-section">
        <h4 className="ssv-section-title">Recorded phase points</h4>
        <p>Each phase uses its own observed matches; missing phases are unknown.</p>
        <div className="ssv-phase-grid">
          {PHASES.map((phase) => {
            const lv = phase.value(left);
            const rv = phase.value(right);
            const lPct = ((lv ?? 0) / phaseMax) * 100;
            const rPct = ((rv ?? 0) / phaseMax) * 100;
            const lWins = lv != null && rv != null ? lv >= rv : undefined;
            return (
              <div key={phase.key} className="ssv-phase-row">
                <div className="ssv-phase-left">
                  <span className="ssv-phase-val" data-winner={lWins}>{pointValue(lv)}</span>
                  <span className="ssv-phase-bar-left">
                    <span className="ssv-phase-fill" data-phase={phase.key} style={{ width: `${lPct}%` }} />
                  </span>
                </div>
                <span className="ssv-phase-label">{phase.label}</span>
                <div className="ssv-phase-right">
                  <span className="ssv-phase-bar-right">
                    <span className="ssv-phase-fill" data-phase={phase.key} style={{ width: `${rPct}%` }} />
                  </span>
                  <span className="ssv-phase-val" data-winner={lWins == null ? undefined : !lWins}>{pointValue(rv)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metric table — every number lined up left↔right with winner highlight */}
      <div className="ssv-metrics-section">
        <h4 className="ssv-section-title">Full breakdown</h4>
        <p>Climb rates use known outcomes, excluding missing and tied reports. {left.climbSamples ? `${teamNumberLabel(left.teamKey)}: ${left.climbSamples.observed} known, ${left.climbSamples.missing} unknown.` : ""} {right.climbSamples ? `${teamNumberLabel(right.teamKey)}: ${right.climbSamples.observed} known, ${right.climbSamples.missing} unknown.` : ""}</p>
        <table className="ssv-metrics">
          <thead>
            <tr>
              <th className="ssv-mh-left">{teamNumberLabel(left.teamKey)}</th>
              <th className="ssv-mh-label" />
              <th className="ssv-mh-right">{teamNumberLabel(right.teamKey)}</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const leftWinsMetric = m.left != null && m.right != null ? (m.higherIsBetter ? m.left >= m.right : m.left <= m.right) : undefined;
              const fmt = m.format ?? ((v: number) => v.toFixed(1));
              return (
                <tr key={m.label}>
                  <td className="ssv-mv-left" data-winner={leftWinsMetric || undefined}>{m.left == null ? "Unknown" : fmt(m.left)}</td>
                  <td className="ssv-mv-label">{m.label}</td>
                  <td className="ssv-mv-right" data-winner={leftWinsMetric == null ? undefined : !leftWinsMetric || undefined}>{m.right == null ? "Unknown" : fmt(m.right)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Overlaid match-by-match trend */}
      <div className="ssv-trend-section">
        <h4 className="ssv-section-title">Match by match</h4>
        <OverlayTrendChart left={left} right={right} max={seriesMax} />
        <ul className="ssv-trend-legend">
          <li data-side="left">
            <span className="ssv-legend-dot" />
            {teamNumberLabel(left.teamKey)}
          </li>
          <li data-side="right">
            <span className="ssv-legend-dot" />
            {teamNumberLabel(right.teamKey)}
          </li>
        </ul>
      </div>

      {/* Verdict */}
      <footer className="ssv-verdict">
        <span className="ssv-verdict-team">{teamNumberLabel(leftWins ? left.teamKey : right.teamKey)}</span>
        <span className="ssv-verdict-text">
          leads by <strong>{gap.toFixed(1)}</strong> points per match
        </span>
      </footer>
    </section>
  );
}

/* ---- Overlay trend chart (pure SVG) -------------------------------------- */

const CHART_W = 340;
const CHART_H = 120;
const PAD = { top: 10, right: 8, bottom: 20, left: 24 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = value > 100 ? 20 : value > 40 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function linePath(series: readonly number[], max: number): string {
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const step = series.length > 1 ? plotW / (series.length - 1) : 0;
  return series
    .map((value, index) => {
      const x = PAD.left + index * step;
      const y = PAD.top + plotH - (Math.max(value, 0) / max) * plotH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function OverlayTrendChart({
  left,
  right,
  max,
}: {
  left: ScoutedTeamProfile;
  right: ScoutedTeamProfile;
  max: number;
}) {
  const hasLeft = left.series.length >= 2;
  const hasRight = right.series.length >= 2;

  if (!hasLeft && !hasRight) {
    return <p className="ssv-trend-empty">Not enough matches to draw a trend yet.</p>;
  }

  const plotH = CHART_H - PAD.top - PAD.bottom;
  const ticks = [0, max / 2, max];

  return (
    <svg
      className="ssv-trend-svg"
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      role="img"
      aria-label={`Match by match: ${left.teamKey} vs ${right.teamKey}`}
    >
      {ticks.map((tick) => {
        const y = PAD.top + plotH - (tick / max) * plotH;
        return (
          <g key={tick}>
            <line className="ssv-trend-grid" x1={PAD.left} x2={CHART_W - PAD.right} y1={y} y2={y} />
            <text className="ssv-trend-axis" x={PAD.left - 4} y={y + 3} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        );
      })}
      {hasLeft && (
        <path className="ssv-trend-line" data-side="left" d={linePath(left.series, max)} />
      )}
      {hasRight && (
        <path className="ssv-trend-line" data-side="right" d={linePath(right.series, max)} />
      )}
    </svg>
  );
}
