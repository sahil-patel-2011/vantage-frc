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
import { ScoutingTeamMatchLog } from "./scouting-team-match-log";
import "./scouting-team-detail.css";

export function ScoutingTeamDetail({
  profile,
  compared,
  compareFull,
  onCompare,
  orgId,
  eventKey = null,
}: {
  profile: ScoutedTeamProfile;
  compared: boolean;
  compareFull: boolean;
  onCompare: () => void;
  /** With a team to read from, the pane also shows the robot match by match. */
  orgId?: string;
  eventKey?: string | null;
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
        <div className="std-head-main">
          <span className="std-kicker">Team</span>
          <h3>{number}</h3>
        </div>
        <div className="std-head-right">
          <div className="std-score">
            <strong>{profile.shrunkTotal.toFixed(1)}</strong>
            <small>points per match</small>
          </div>
          <button
            type="button"
            className="std-compare"
            aria-pressed={compared}
            aria-label={compared ? "Remove from comparison" : "Add to comparison"}
            disabled={!compared && compareFull}
            onClick={onCompare}
          >
            {compared ? "✓" : "+"}
          </button>
        </div>
      </header>

      <p className="std-headline">{profile.headline}</p>

      <ScoutingDetailCharts profile={profile} />

      <dl className="std-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {orgId ? <ScoutingTeamMatchLog orgId={orgId} eventKey={eventKey} teamKey={profile.teamKey} /> : null}
    </aside>
  );
}
