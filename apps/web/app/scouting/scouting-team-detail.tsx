"use client";

/**
 * The detail half of the scouting dashboard.
 *
 * The list answers "which robot", this answers "why". It is a sticky pane on a
 * wide screen and a card above the list on a phone, so moving between robots is
 * one tap and the numbers never move around underneath you.
 *
 * Arithmetic only — every number here is already on the page in the profile.
 */

import { CONSISTENCY_LABEL, type ScoutedTeamProfile } from "@vantage/prediction-strategy";
import { ScoutingDetailCharts } from "./scouting-detail-charts";
import "./scouting-team-detail.css";

function phaseSplit(profile: ScoutedTeamProfile) {
  const parts = [
    { label: "Auto", value: profile.meanAuto },
    { label: "Teleop", value: profile.meanTeleop },
    { label: "Endgame", value: profile.meanEndgame },
  ];
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0) || 1;
  return parts.map((part) => ({ ...part, share: Math.max(0, part.value) / total }));
}

export function ScoutingTeamDetail({
  profile,
  compared,
  compareFull,
  onCompare,
}: {
  profile: ScoutedTeamProfile;
  compared: boolean;
  compareFull: boolean;
  onCompare: () => void;
}) {
  const number = profile.teamKey.replace(/^frc/i, "");
  const consistency = profile.consistency?.consistency ?? "unknown";
  const stats: Array<{ label: string; value: string }> = [
    { label: "Matches watched", value: String(profile.matches) },
    { label: "Consistency", value: CONSISTENCY_LABEL[consistency] },
  ];
  if (profile.consistency?.floor != null && profile.consistency.ceiling != null) {
    stats.push({
      label: "Bad day / good day",
      value: `${profile.consistency.floor.toFixed(0)} – ${profile.consistency.ceiling.toFixed(0)}`,
    });
  }
  if (profile.climbRate != null) {
    stats.push({ label: "Climbs", value: `${Math.round(profile.climbRate * 100)}% of matches` });
  }
  if (profile.defenseRate > 0) {
    stats.push({ label: "Plays defense", value: `${Math.round(profile.defenseRate * 100)}% of matches` });
  }
  if (profile.disabledRate > 0) {
    stats.push({ label: "Died", value: `${Math.round(profile.disabledRate * 100)}% of matches` });
  }

  return (
    <aside className="std" aria-label={`Team ${number} detail`} key={profile.teamKey}>
      <header className="std-head">
        <div>
          <span className="std-kicker">Team</span>
          <h3>{number}</h3>
        </div>
        <div className="std-score">
          <strong>{profile.shrunkTotal.toFixed(1)}</strong>
          <small>points per match</small>
        </div>
      </header>

      <p className="std-headline">{profile.headline}</p>

      <div className="std-phases" aria-label="Where the points come from">
        {phaseSplit(profile).map((part) => (
          <div className="std-phase" key={part.label}>
            <span className="std-phase-label">
              {part.label}
              <b>{part.value.toFixed(1)}</b>
            </span>
            <span className="std-phase-track">
              <span className="std-phase-fill" style={{ width: `${(part.share * 100).toFixed(1)}%` }} />
            </span>
          </div>
        ))}
      </div>

      <ScoutingDetailCharts profile={profile} />

      <dl className="std-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <p className="std-sample">{profile.sampleNote}</p>

      <button
        type="button"
        className="std-compare"
        aria-pressed={compared}
        disabled={!compared && compareFull}
        onClick={onCompare}
      >
        {compared ? "Comparing" : "Add to compare"}
      </button>
    </aside>
  );
}
