"use client";

/**
 * Two charts over the profiles already on the page — no request, no chart
 * library, pure arithmetic so they work from the offline snapshot.
 *
 * Bars answer "where do the points come from"; the lines answer "do the last
 * few matches agree with the average". Both are drawn with the same team slot
 * colours the compare cards use, so a colour means one robot everywhere.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
/** Local so this module does not import back into the panel that renders it. */
function teamNumberLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

const PHASES = [
  { key: "auto", label: "Auto", value: (p: ScoutedTeamProfile) => p.meanAuto },
  { key: "teleop", label: "Teleop", value: (p: ScoutedTeamProfile) => p.meanTeleop },
  { key: "endgame", label: "Endgame", value: (p: ScoutedTeamProfile) => p.meanEndgame },
] as const;

const W = 320;
const H = 132;
const PAD = { top: 10, right: 8, bottom: 22, left: 8 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const step = value > 100 ? 20 : value > 40 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function linePath(series: readonly number[], max: number): string {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = series.length > 1 ? plotW / (series.length - 1) : 0;
  return series
    .map((value, index) => {
      const x = PAD.left + index * step;
      const y = PAD.top + plotH - (Math.max(value, 0) / max) * plotH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function ScoutingCompareCharts({ profiles }: { profiles: ScoutedTeamProfile[] }) {
  if (profiles.length < 2) return null;

  const phaseMax = niceMax(
    Math.max(...profiles.flatMap((profile) => PHASES.map((phase) => phase.value(profile)))),
  );
  const withSeries = profiles.filter((profile) => profile.series.length > 1);
  const seriesMax = niceMax(Math.max(1, ...withSeries.flatMap((profile) => profile.series)));
  const longest = Math.max(0, ...withSeries.map((profile) => profile.series.length));
  const plotH = H - PAD.top - PAD.bottom;

  return (
    <div className="scmp-charts">
      <figure className="scmp-chart">
        <figcaption>
          Points by phase <span>per match average</span>
        </figcaption>
        <div className="scmp-chart-bars">
          {PHASES.map((phase) => (
            <div className="scmp-chart-group" key={phase.key}>
              <div className="scmp-chart-columns">
                {profiles.map((profile, index) => {
                  const value = phase.value(profile);
                  return (
                    <span
                      key={profile.teamKey}
                      className="scmp-chart-column"
                      data-slot={index + 1}
                      style={{ height: `${(value / phaseMax) * 100}%` }}
                      title={`${teamNumberLabel(profile.teamKey)} · ${phase.label} ${value.toFixed(1)}`}
                    />
                  );
                })}
              </div>
              <span className="scmp-chart-tick">{phase.label}</span>
            </div>
          ))}
        </div>
      </figure>

      <figure className="scmp-chart">
        <figcaption>
          Match by match <span>total points, in order</span>
        </figcaption>
        {withSeries.length > 0 ? (
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Match by match totals for each robot">
            {[0, 0.5, 1].map((fraction) => (
              <line
                key={fraction}
                className="scmp-chart-grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={PAD.top + plotH * fraction}
                y2={PAD.top + plotH * fraction}
              />
            ))}
            {withSeries.map((profile) => (
              <path
                key={profile.teamKey}
                className="scmp-chart-line"
                data-slot={profiles.indexOf(profile) + 1}
                d={linePath(profile.series, seriesMax)}
              />
            ))}
          </svg>
        ) : (
          <p className="scmp-chart-empty">Two or more matches per robot are needed to draw this.</p>
        )}
        <span className="scmp-chart-axis">
          <span>Match 1</span>
          <span>{longest > 1 ? `Match ${longest}` : ""}</span>
        </span>
      </figure>

      <ul className="scmp-chart-legend">
        {profiles.map((profile, index) => (
          <li key={profile.teamKey} data-slot={index + 1}>
            <span aria-hidden="true" />
            {teamNumberLabel(profile.teamKey)}
          </li>
        ))}
      </ul>
    </div>
  );
}
