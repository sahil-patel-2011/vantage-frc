"use client";

import { useMemo, useState } from "react";
import type { ObservedRobot } from "../../lib/scouting/team-profiles";
import { buildEventTrend, eventTrendMetrics } from "../../lib/scouting/event-trends";
import { scoutOptionLabel } from "../../lib/scouting/option-label";
import styles from "./scouting-event-trends.module.css";

export function ScoutingEventTrends({ robots, eventKey, teamNumber }: { robots: ObservedRobot[]; eventKey: string | null; teamNumber?: string }) {
  const [includeLow, setIncludeLow] = useState(false);
  const [selected, setSelected] = useState<{ eventKey: string | null; key: string } | null>(null);
  const metrics = useMemo(() => eventKey ? eventTrendMetrics(robots, eventKey, includeLow) : [], [robots, eventKey, includeLow]);
  const metric = metrics.find(item => selected?.eventKey === eventKey && item.key === selected?.key)
    ?? metrics.find(item => /climb|tower/i.test(item.label) && !/auto|attempt|capab|can /i.test(item.label) && !item.incompatible)
    ?? metrics.find(item => !item.incompatible) ?? metrics[0];
  const trend = useMemo(() => metric ? buildEventTrend(robots, eventKey ?? "", metric, includeLow) : null, [robots, eventKey, metric, includeLow]);
  const periods = trend?.recent ? [
    { label: trend.recent.earlyLabel, sample: trend.recent.early },
    { label: trend.recent.lateLabel, sample: trend.recent.late },
  ] : [];

  return <section className={styles.trends} aria-label={teamNumber ? `Team ${teamNumber} scouting trends` : "Event scouting trends"}>
    <header>
      <span className={styles.eyebrow}>From your observations</span>
      <h3>{teamNumber ? `Team ${teamNumber} trends` : "Event trends"}</h3>
      <p>{teamNumber ? "Patterns across this robot’s observed matches." : "Patterns across the robots your team watched."} Unanswered questions stay out of the conclusion.</p>
    </header>
    <div className={styles.controls}>
      {metrics.length ? <label>Trend metric
        <select value={metric?.key ?? ""} onChange={event => setSelected({ eventKey, key: event.target.value })}>
          {metrics.map(item => <option key={item.key} value={item.key}>{item.label}{item.incompatible ? " · incompatible forms" : ""}</option>)}
        </select>
      </label> : null}
      {eventKey ? <label className={styles.confidence}><input type="checkbox" checked={includeLow} onChange={event => setIncludeLow(event.target.checked)} />Include low-confidence reports</label> : null}
    </div>
    {!metric || !trend ? <div className={styles.empty}><strong>{eventKey ? "Your observations will build this view" : "Choose an event to see its trends"}</strong><p>{eventKey ? "Collect match reports with numbers, yes/no answers or choices. Pit visits stay in robot profiles." : "Trends use the active event’s match reports."}</p></div>
      : metric.incompatible ? <p role="status">This field has different types, units or answer formats across form versions. Choose a compatible metric; these answers are not pooled.</p>
      : <>
        <div className={styles.stats}>
          <div><strong>{trend.knownTeams}<small> / {trend.watchedTeams}</small></strong><span>watched robots with answers</span></div>
          <div><strong>{trend.answered}<small> / {trend.total}</small></strong><span>robot-matches with answers</span></div>
          <div><strong>{trend.missing}</strong><span>unanswered or unresolved</span></div>
        </div>
        {!trend.answered ? <p>No known answers for this metric. Missing answers do not count as a negative.</p> : <>
          {trend.noClimb ? <div className={styles.insight}><strong>{trend.neverClimbed.length} of {trend.knownTeams} robots have no successful climb recorded</strong><p>This describes {metric.label.toLowerCase()} outcomes. It does not establish whether they tried to climb, or why a climb did not happen.</p></div> : null}
          {trend.notAttempted > 0 ? <div className={styles.insight}><strong>{trend.notAttempted}/{trend.answered} answers explicitly report no climb attempt</strong><p>{Math.round(trend.notAttempted / trend.answered * 100)}% of answered robot-matches. Failed climbs and missing observations do not count as “did not attempt.”</p></div> : null}
          {trend.mean !== null ? <div className={styles.insight}><strong>{trend.mean.toFixed(2)}{metric.unit ? ` ${metric.unit}` : ""} average</strong><p>Per answered robot-match, with repeated reports combined first.</p></div>
            : <ul className={styles.outcomes} aria-label={`${metric.label} outcomes`}>{trend.outcomes.map(([value, count]) => <li key={value}>
              <span>{scoutOptionLabel(value)}</span><strong>{count}/{trend.answered} · {Math.round(count / trend.answered * 100)}%</strong>
              <div className={styles.track} aria-hidden="true"><span style={{ width: `${count / trend.answered * 100}%` }} /></div>
            </li>)}</ul>}
          {periods.length > 0 && (trend.mean !== null || trend.noClimb || metric.type === "boolean") ? <div className={styles.periods}>
            <h4>Earlier vs later qualifications</h4><p>Different robots and coverage can change the result. This comparison does not prove a strategy change.</p>
            {periods.map(({ label, sample }) => <div key={label}>
              <span>{label}</span><strong>{sample.value === null ? "Not recorded" : trend.mean !== null ? `${sample.value.toFixed(2)}${metric.unit ? ` ${metric.unit}` : ""}` : `${Math.round(sample.value * 100)}% ${trend.noClimb ? "climbed" : "yes"}`}</strong>
              <small>{sample.answered}/{sample.total} answered robot-matches · {sample.teams} robots</small>
            </div>)}
          </div> : null}
          <details><summary data-disclosure>Contributing answers <span>{trend.answered}</span></summary>
            <div className={styles.scroll} tabIndex={0} role="region" aria-label="Trend contributing answers"><table>
              <caption>{metric.label} · combined robot-match answers</caption>
              <thead><tr><th scope="col">Robot</th><th scope="col">Match</th><th scope="col">Answer</th></tr></thead>
              <tbody>{trend.rows.map(row => <tr key={`${row.teamKey}:${row.matchKey}`}>
                <td>{row.teamKey?.replace(/^frc/, "")}</td><td>{row.matchKey?.split("_").at(-1)}</td>
                <td>{typeof row.payload[metric.key] === "number" ? Number(row.payload[metric.key]).toFixed(2) : scoutOptionLabel(String(row.payload[metric.key]))}</td>
              </tr>)}</tbody>
            </table></div>
          </details>
        </>}
        <p className={styles.footnote}>{trend.reports} reports combined into {trend.total} robot-matches · {trend.disagreements} disagreements for this metric. Numeric duplicates are averaged; tied choice disagreements stay unanswered. {includeLow ? "Low-confidence reports included." : "Low-confidence reports excluded."}</p>
      </>}
  </section>;
}
