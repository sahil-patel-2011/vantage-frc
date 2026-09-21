"use client";

/**
 * The field at a glance — every robot's per-match average as a bar.
 *
 * Sits between the summary stats and the master–detail list, so a pick-list
 * meeting opens with the shape of the field before drilling into any one
 * robot. The selected team's bar is highlighted; the field average is drawn
 * as a vertical reference line.
 *
 * Pure arithmetic over profiles already on the page — no request, works
 * offline.
 */

import { useMemo } from "react";
import type { ScoutedTeamProfile } from "@vantage/prediction-strategy";
import "./scouting-field-chart.css";

function teamNumber(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export function ScoutingFieldChart({
  profiles,
  selectedKey,
  compareKeys,
  onSelect,
}: {
  profiles: ScoutedTeamProfile[];
  selectedKey: string | null;
  compareKeys: readonly string[];
  onSelect: (teamKey: string) => void;
}) {
  const sorted = useMemo(
    () => [...profiles].sort((a, b) => b.shrunkTotal - a.shrunkTotal),
    [profiles],
  );

  if (sorted.length < 2) return null;

  const max = Math.max(...sorted.map((p) => p.shrunkTotal), 1);
  const fieldAvg =
    sorted.reduce((sum, p) => sum + p.shrunkTotal, 0) / sorted.length;
  const avgPct = (fieldAvg / max) * 100;

  return (
    <figure className="sfc" aria-label="Field comparison">
      <figcaption>
        Field comparison <span>points per match, highest first</span>
      </figcaption>
      <div className="sfc-bars" role="list">
        {sorted.map((profile) => {
          const number = teamNumber(profile.teamKey);
          const pct = (profile.shrunkTotal / max) * 100;
          const isSelected = profile.teamKey === selectedKey;
          const isCompared = compareKeys.includes(profile.teamKey);
          return (
            <button
              key={profile.teamKey}
              type="button"
              className="sfc-bar"
              data-selected={isSelected ? "true" : undefined}
              data-compared={isCompared ? "true" : undefined}
              role="listitem"
              onClick={() => onSelect(profile.teamKey)}
              title={`Team ${number}: ${profile.shrunkTotal.toFixed(1)} per match`}
            >
              <span className="sfc-bar-label">{number}</span>
              <span className="sfc-bar-track">
                <span
                  className="sfc-bar-fill"
                  style={{ width: `${Math.max(pct, 2).toFixed(1)}%` }}
                />
              </span>
              <span className="sfc-bar-value">{profile.shrunkTotal.toFixed(1)}</span>
            </button>
          );
        })}
      </div>
      <div className="sfc-avg" aria-hidden="true" style={{ left: `${avgPct.toFixed(1)}%` }}>
        <span className="sfc-avg-label">avg {fieldAvg.toFixed(1)}</span>
      </div>
    </figure>
  );
}
