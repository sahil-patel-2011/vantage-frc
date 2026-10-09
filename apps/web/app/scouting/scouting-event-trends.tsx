"use client";

import { useMemo, useState } from "react";
import type { ObservedRobot } from "../../lib/scouting/team-profiles";
import { buildEventTrend, eventTrendMetrics } from "../../lib/scouting/event-trends";
import type { ClimbOutcome } from "../../lib/scouting/climb-outcome";
import { scoutOptionLabel } from "../../lib/scouting/option-label";
import styles from "./scouting-event-trends.module.css";

const CLIMB_LABELS: Record<ClimbOutcome, string> = {
  successful: "Successful climb", failed: "Attempted but failed", not_attempted: "Explicitly not attempted",
  no_success: "No successful climb · attempt unclear", unseen: "Unseen or unresolved",
};

export function ScoutingEventTrends({ robots, eventKey, teamDetailKeys, onOpenTeam }: {
  robots: ObservedRobot[];
  eventKey: string | null;
  teamDetailKeys?: string[];
  onOpenTeam?: (teamKey: string, button: HTMLButtonElement) => void;
}) {
  const [includeLow, setIncludeLow] = useState(false);
  const [selected, setSelected] = useState("");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLimit, setEvidenceLimit] = useState(100);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const detailKeys = useMemo(() => new Set(teamDetailKeys), [teamDetailKeys]);
  const metrics = useMemo(() => eventKey ? eventTrendMetrics(robots, eventKey, includeLow) : [], [robots, eventKey, includeLow]);
  const metric = metrics.find(item => item.key === selected)
    ?? metrics.find(item => /climb|tower/i.test(item.label) && !/auto|attempt|capab/i.test(item.label)) ?? metrics[0];
  const trend = useMemo(() => metric ? buildEventTrend(robots, eventKey ?? "", metric, includeLow) : null, [robots, eventKey, metric, includeLow]);
  const outcomeRows = trend?.noClimb
    ? Object.entries(trend.climbOutcomes).map(([outcome, count]) => [CLIMB_LABELS[outcome as ClimbOutcome], count] as const)
    : trend?.outcomes.map(([value, count]) => [scoutOptionLabel(value), count] as const) ?? [];
  const robotLabel = (teamKey: string) => teamKey.replace(/^frc/i, "");
  const teamCell = (teamKey: string) => onOpenTeam && detailKeys.has(teamKey)
    ? <button type="button" className={styles.robotLink} aria-label={`Open team ${robotLabel(teamKey)}`} onClick={event => onOpenTeam(teamKey, event.currentTarget)}>{robotLabel(teamKey)}</button>
    : robotLabel(teamKey);

  return <section className={styles.trends} aria-label="Event scouting trends">
    <header><span className={styles.eyebrow}>From your observations</span><h3>Event trends</h3><p>See what the robots you watched are doing. Missing observations stay visible and never become a negative.</p></header>
    {metrics.length ? <div className={styles.controls}>
      <label>Trend metric<select value={metric?.key ?? ""} onChange={event => { setSelected(event.target.value); setEvidenceLimit(100); }}>
        {metrics.map(item => <option key={item.key} value={item.key}>{item.label}{item.incompatible ? " · incompatible forms" : ""}</option>)}
      </select></label>
      <label className={styles.confidence}><input type="checkbox" checked={includeLow} onChange={event => { setIncludeLow(event.target.checked); setEvidenceLimit(100); }} />Include low-confidence reports</label>
    </div> : null}
    {!metric || !trend ? <p>{eventKey ? "No supported observations yet. Collect match reports to see event trends." : "Choose an active event to see its scouting trends."}</p> : metric.incompatible ? <p role="status">This field has different types or units across form versions. These answers are not pooled. Choose another metric.</p> : <>
      <p className={styles.scope}>Event {eventKey} · {includeLow ? "All confidence levels" : "Low-confidence reports excluded"} · All watched robots</p>
      <div className={styles.stats}>
        <div><strong>{trend.knownTeams}/{trend.watchedTeams}</strong><span>robots with a known outcome</span></div>
        <div><strong>{trend.answered}/{trend.total}</strong><span>answered robot-matches</span></div>
        <div><strong>{trend.missing}</strong><span>missing or unresolved</span></div>
      </div>
      {trend.unasked > 0 ? <p>{trend.unasked} robot-matches used a form without this question. They are included in the coverage gap, not in the outcome rate.</p> : null}
      {!trend.answered ? <p>No known answers for this metric. Missing answers do not count as a negative.</p> : null}
      {trend.noClimb && trend.answered > 0 ? <p className={styles.insight}>
        <strong>{trend.neverClimbed.length} of {trend.knownTeams} robots have only non-success outcomes recorded.</strong>
        “None,” parking and an unchecked success answer do not establish whether a climb was attempted. Only an explicit answer identifies a failed attempt or no attempt.
      </p> : null}
      {trend.mean !== null ? <p className={styles.insight}><strong>{trend.mean.toFixed(2)}{metric.unit ? ` ${metric.unit}` : ""}</strong> average per answered robot-match.</p> : outcomeRows.length && trend.total > 0 ? <>
        {trend.noClimb ? <h4>Climb outcomes</h4> : null}
        <ul className={styles.outcomes}>{outcomeRows.map(([label, count]) => {
          const denominator = trend.noClimb ? trend.total : trend.answered;
          const percent = denominator ? count / denominator * 100 : 0;
          return <li key={label}><span>{label}</span><div className={styles.track} aria-hidden="true"><span style={{ width: `${percent}%` }} /></div><strong>{count}/{denominator} · {Math.round(percent)}%</strong></li>;
        })}</ul>
      </> : null}
      {trend.recent && (trend.mean !== null || trend.noClimb || metric.type === "boolean") ? <div className={styles.periods}>
        <h4>Earlier vs later qualifications</h4><p>Each period uses its own known outcomes. Coverage and robots watched can change; this does not prove a strategy change.</p>
        {[ { label: trend.recent.earlyLabel, sample: trend.recent.early }, { label: trend.recent.lateLabel, sample: trend.recent.late } ].map(({ label, sample }) => <div key={label}>
          <span>{label}</span><strong>{sample.value === null ? "Not recorded" : trend.mean !== null ? `${sample.value.toFixed(2)}${metric.unit ? ` ${metric.unit}` : ""}` : `${Math.round(sample.value * 100)}% ${trend.noClimb ? "successful climbs" : "yes"}`}</strong><small>{sample.answered} known outcomes</small>
        </div>)}
      </div> : null}
      {trend.noClimb ? <details open={teamsOpen} onToggle={event => setTeamsOpen(event.currentTarget.open)}>
        <summary data-disclosure>Climb evidence by robot</summary>
        {teamsOpen ? <div className={styles.scroll} tabIndex={0} role="region" aria-label="Climb evidence by robot"><table>
          <caption>{metric.label} · one outcome per robot-match</caption>
          <thead><tr><th scope="col">Robot</th><th scope="col">Success</th><th scope="col">Failed attempt</th><th scope="col">Not attempted</th><th scope="col">Attempt unclear</th><th scope="col">Unseen</th><th scope="col">Known / watched</th></tr></thead>
          <tbody>{trend.teamClimbs.map(team => <tr key={team.teamKey}><th scope="row">{teamCell(team.teamKey)}</th><td>{team.outcomes.successful}</td><td>{team.outcomes.failed}</td><td>{team.outcomes.not_attempted}</td><td>{team.outcomes.no_success}</td><td>{team.outcomes.unseen}</td><td>{team.observed}/{team.total}</td></tr>)}</tbody>
        </table></div> : null}
      </details> : null}
      <details open={evidenceOpen} onToggle={event => setEvidenceOpen(event.currentTarget.open)}>
        <summary data-disclosure>Contributing answers</summary>
        {evidenceOpen ? <>
          <div className={styles.scroll} tabIndex={0} role="region" aria-label="Trend contributing answers"><table>
            <caption>{metric.label} · {Math.min(evidenceLimit, trend.rows.length)} of {trend.rows.length} known outcomes</caption>
            <thead><tr><th scope="col">Robot</th><th scope="col">Match</th><th scope="col">Answer</th></tr></thead>
            <tbody>{trend.rows.slice(0, evidenceLimit).map(row => <tr key={`${row.teamKey}:${row.matchKey}`}><th scope="row">{teamCell(row.teamKey ?? "")}</th><td>{row.matchKey?.split("_").at(-1)}</td><td>{row.payload[metric.key] === undefined && trend.noClimb ? `${CLIMB_LABELS[row.climbOutcome]} · original answers disagree` : typeof row.payload[metric.key] === "number" ? Number(row.payload[metric.key]).toFixed(2) : scoutOptionLabel(String(row.payload[metric.key]))}</td></tr>)}</tbody>
          </table></div>
          {trend.rows.length > evidenceLimit ? <button type="button" className={styles.more} onClick={() => setEvidenceLimit(limit => limit + 100)}>Show next {Math.min(100, trend.rows.length - evidenceLimit)} answers</button> : null}
        </> : null}
      </details>
      <p className={styles.footnote}>{trend.reports} reports reduced to {trend.total} robot-matches · {trend.disagreements} disagreements for this metric. Numeric duplicates are averaged within a robot-match. Success uses a majority of known outcomes; tied success votes remain unknown. A height disagreement can still establish success. {includeLow ? "Low-confidence reports included." : "Low-confidence reports excluded."}</p>
    </>}
  </section>;
}
