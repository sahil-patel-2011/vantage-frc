"use client";

/**
 * Two or three robots, side by side.
 *
 * The list answers "who is good"; a pick-list argument is almost always
 * "which of these two". That question is answered by shape, not by reading
 * two rows of digits: where the points come from, how far the bad day is from
 * the good day, and whether the last few matches agree with the average.
 *
 * Everything here is arithmetic over profiles already on the page, so it works
 * from the offline snapshot and never waits on a request.
 */

import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
import { CONSISTENCY_LABEL } from "@vantage/prediction-strategy";
import "./scouting-compare.css";

export const COMPARE_LIMIT = 3;

export function teamNumberLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

type Phase = { key: "auto" | "teleop" | "endgame"; label: string; value: (p: ScoutedTeamProfile) => number };

const PHASES: Phase[] = [
  { key: "auto", label: "Auto", value: (p) => p.meanAuto },
  { key: "teleop", label: "Teleop", value: (p) => p.meanTeleop },
  { key: "endgame", label: "Endgame", value: (p) => p.meanEndgame },
];

export function ScoutingCompare({
  profiles,
  onRemove,
  onClear,
}: {
  profiles: ScoutedTeamProfile[];
  onRemove: (teamKey: string) => void;
  onClear: () => void;
}) {
  if (profiles.length < 2) return null;

  const phaseMax = Math.max(
    1,
    ...profiles.flatMap((profile) => PHASES.map((phase) => phase.value(profile))),
  );
  const rangeFloor = Math.min(
    0,
    ...profiles.map((profile) => profile.consistency?.floor ?? profile.shrunkTotal),
  );
  const rangeCeiling = Math.max(
    1,
    ...profiles.map((profile) => profile.consistency?.ceiling ?? profile.shrunkTotal),
  );
  const best = profiles.reduce((top, profile) => (profile.shrunkTotal > top.shrunkTotal ? profile : top));

  return (
    <section className="scmp" aria-label="Compare robots">
      <header className="scmp-head">
        <h3>Comparing {profiles.map((profile) => teamNumberLabel(profile.teamKey)).join(" vs ")}</h3>
        <button type="button" className="scmp-clear" onClick={onClear}>
          Clear
        </button>
      </header>

      <div className="scmp-grid" style={{ "--scmp-cols": profiles.length } as React.CSSProperties}>
        {profiles.map((profile, index) => {
          const consistency = profile.consistency?.consistency ?? "unknown";
          const floor = profile.consistency?.floor ?? profile.shrunkTotal;
          const ceiling = profile.consistency?.ceiling ?? profile.shrunkTotal;
          const span = rangeCeiling - rangeFloor || 1;
          return (
            <article key={profile.teamKey} className="scmp-card" data-slot={index + 1}>
              <header>
                <span className="scmp-team">{teamNumberLabel(profile.teamKey)}</span>
                <span className="scmp-total">
                  <strong>{profile.shrunkTotal.toFixed(1)}</strong>
                  <small>per match</small>
                </span>
                <button
                  type="button"
                  className="scmp-remove"
                  onClick={() => onRemove(profile.teamKey)}
                  aria-label={`Remove ${teamNumberLabel(profile.teamKey)} from the comparison`}
                >
                  ×
                </button>
              </header>

              {profile.teamKey === best.teamKey ? <p className="scmp-lead">Highest scoring here</p> : null}

              <ul className="scmp-phases">
                {PHASES.map((phase) => {
                  const value = phase.value(profile);
                  return (
                    <li key={phase.key}>
                      <span className="scmp-phase-label">{phase.label}</span>
                      <span className="scmp-bar" aria-hidden="true">
                        <span
                          className="scmp-bar-fill"
                          data-phase={phase.key}
                          style={{ width: `${(value / phaseMax) * 100}%` }}
                        />
                      </span>
                      <span className="scmp-phase-value">{value.toFixed(1)}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="scmp-range">
                <span className="scmp-phase-label">Bad day → good day</span>
                <span className="scmp-range-track" aria-hidden="true">
                  <span
                    className="scmp-range-fill"
                    style={{
                      left: `${((floor - rangeFloor) / span) * 100}%`,
                      width: `${(Math.max(ceiling - floor, 0.5) / span) * 100}%`,
                    }}
                  />
                </span>
                <span className="scmp-phase-value">
                  {floor.toFixed(0)}–{ceiling.toFixed(0)}
                </span>
              </div>

              <dl className="scmp-facts">
                <div>
                  <dt>Matches</dt>
                  <dd>{profile.matches}</dd>
                </div>
                <div>
                  <dt>Consistency</dt>
                  <dd>{CONSISTENCY_LABEL[consistency]}</dd>
                </div>
                <div>
                  <dt>Trend</dt>
                  <dd>
                    {profile.trend && profile.trend.direction !== "flat"
                      ? profile.trend.direction === "up"
                        ? "Improving"
                        : "Falling off"
                      : "Flat"}
                  </dd>
                </div>
                <div>
                  <dt>Dead</dt>
                  <dd>{Math.round(profile.disabledRate * 100)}%</dd>
                </div>
              </dl>

              <p className="scmp-headline">{profile.headline}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
