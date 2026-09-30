"use client";

/**
 * The detail half of the scouting dashboard.
 *
 * The list answers "which robot", this answers "why". It is a sticky pane on a
 * wide screen and a focused view on a phone. Returning to the list preserves
 * the selected robot, filters, scroll position, and keyboard focus.
 *
 * Arithmetic only — every number here is already on the page in the profile.
 */

import { useId, useState } from "react";
import { CONSISTENCY_LABEL, type ScoutedTeamProfile } from "@vantage/prediction-strategy";
import type { ObservedRobot } from "../../lib/scouting/team-profiles";
import { ScoutObservationExplorer } from "../intel/scout-observation-explorer";
import { ScoutingDetailCharts } from "./scouting-detail-charts";
import { ScoutingTeamMatchLog } from "./scouting-team-match-log";
import "./scouting-team-detail.css";

const SECTIONS = [
  ["overview", "Overview"],
  ["matches", "Matches"],
  ["capabilities", "Capabilities"],
  ["notes", "Notes"],
] as const;
type ProfileSection = (typeof SECTIONS)[number][0];

export function ScoutingTeamDetail({
  profile,
  compared,
  compareFull,
  onCompare,
  orgId,
  eventKey = null,
  observations,
  onBack,
}: {
  profile: ScoutedTeamProfile;
  compared: boolean;
  compareFull: boolean;
  onCompare: () => void;
  /** With a team to read from, the pane also shows the robot match by match. */
  orgId?: string;
  eventKey?: string | null;
  observations?: ObservedRobot;
  onBack?: () => void;
}) {
  const [section, setSection] = useState<ProfileSection>("overview");
  const id = useId();
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
    stats.push({ label: "Breakdown reported", value: `${Math.round(profile.disabledRate * 100)}% of matches` });
  }

  return (
    <aside className="std" aria-label={`Team ${number} detail`} tabIndex={-1}>
      {onBack ? <button type="button" className="std-back" onClick={onBack}>← All robots</button> : null}
      <header className="std-head">
        <div className="std-head-main">
          <span className="std-kicker">Team</span>
          <h3>{number}</h3>
        </div>
        <div className="std-head-right">
          <div className="std-score">
            <strong>{profile.meanTotal.toFixed(1)}</strong>
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
      <div className="std-sections" role="tablist" aria-label={`Team ${number} sections`}>
        {SECTIONS.map(([key, label], index) => <button
          key={key} type="button" role="tab" id={`${id}-${key}`}
          aria-selected={section === key} aria-controls={`${id}-panel`}
          tabIndex={section === key ? 0 : -1}
          onClick={() => setSection(key)}
          onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length
              : event.key === "ArrowLeft" ? (index + SECTIONS.length - 1) % SECTIONS.length
              : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : null;
            if (next == null) return;
            event.preventDefault();
            setSection(SECTIONS[next]![0]);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}
        >{label}</button>)}
      </div>
      <div className="std-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${section}`} tabIndex={0}>
      {section === "overview" ? <>
      <dl className="std-stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>
      <ScoutingDetailCharts profile={profile} />
      </> : null}
      {section === "matches" ? <>
        {orgId ? <ScoutingTeamMatchLog orgId={orgId} eventKey={eventKey} teamKey={profile.teamKey} /> : <p className="app-muted">Match history is unavailable.</p>}
        {observations?.reports.length ? <details className="std-reports"><summary data-disclosure>Original scout reports</summary><ScoutObservationExplorer rows={observations.reports} activeEventKey={eventKey} sectionView="matches" /></details> : null}
      </> : null}
      {section === "capabilities" || section === "notes" ? observations?.reports.length ?
        <ScoutObservationExplorer rows={observations.reports} activeEventKey={eventKey} sectionView={section === "notes" ? "notes" : "metrics"} />
        : <p className="app-muted">No {section === "notes" ? "notes" : "capability observations"} recorded for this robot.</p> : null}
      </div>
    </aside>
  );
}
