"use client";
import { useMemo, useState } from "react";
import type { ObservedRobot } from "../../lib/scouting/team-profiles";
import { buildEventTrend, eventTrendMetrics } from "../../lib/scouting/event-trends";
import { scoutOptionLabel } from "../../lib/scouting/option-label";
import styles from "./scouting-event-trends.module.css";

export function ScoutingEventTrends({ robots, eventKey }: { robots: ObservedRobot[]; eventKey: string | null }) {
  const [includeLow, setIncludeLow] = useState(false);
  const [selected, setSelected] = useState("");
  const metrics = useMemo(() => eventKey ? eventTrendMetrics(robots, eventKey, includeLow) : [], [robots,eventKey,includeLow]);
  const metric = metrics.find(item => item.key === selected) ?? metrics.find(item => /climb|tower/i.test(item.label) && !/auto/i.test(item.label)) ?? metrics[0];
  const trend = useMemo(() => metric ? buildEventTrend(robots, eventKey ?? "", metric, includeLow) : null, [robots,eventKey,metric,includeLow]);
  return <section className={styles.trends} aria-label="Event scouting trends">
    <header><span className={styles.eyebrow}>From your observations</span><h3>Event trends</h3><p>See what the robots you watched are doing. Unwatched robots and unanswered questions stay out of the conclusion.</p></header>
    <div className={styles.controls}><label>Trend metric<select aria-label="Trend metric" value={metric?.key ?? ""} onChange={event => setSelected(event.target.value)}>{metrics.map(item => <option key={item.key} value={item.key}>{item.label}{item.incompatible ? " · incompatible forms" : ""}</option>)}</select></label><label><input type="checkbox" checked={includeLow} onChange={event => setIncludeLow(event.target.checked)} />Include low-confidence reports</label></div>
    {!metric || !trend ? <p>{eventKey ? "No supported observations yet. Collect match reports to see event trends." : "Choose an active event to see its scouting trends."}</p> : metric.incompatible ? <p role="status">This field has different types or units across form versions. Choose a compatible metric; these answers are not pooled.</p> : <>
      <div className={styles.stats}><div><strong>{trend.knownTeams}/{trend.watchedTeams}</strong><span>robots with an answer</span></div><div><strong>{trend.answered}/{trend.total}</strong><span>robot-match answers</span></div><div><strong>{trend.missing}</strong><span>missing or unresolved</span></div></div>
      {!trend.answered ? <p>No known answers for this metric. Missing answers do not count as a negative.</p> : <>
        {trend.noClimb ? <p className={styles.insight}><strong>{trend.neverClimbed.length} of {trend.knownTeams} observed robots have no climb recorded.</strong> This describes {metric.label.toLowerCase()} outcomes, not whether a climb was attempted or why it did not happen.</p> : null}
        {trend.mean !== null ? <p className={styles.insight}><strong>{trend.mean.toFixed(2)}{metric.unit ? ` ${metric.unit}` : ""}</strong> average per answered robot-match.</p> : <ul className={styles.outcomes}>{trend.outcomes.map(([value,count]) => <li key={value}><span>{scoutOptionLabel(value)}</span><div className={styles.track} aria-hidden="true"><span style={{ width: `${count / trend.answered * 100}%` }} /></div><strong>{count}/{trend.answered} · {Math.round(count / trend.answered * 100)}%</strong></li>)}</ul>}
        {trend.recent && (trend.mean !== null || trend.noClimb || metric.type === "boolean") ? <div className={styles.periods}><h4>Earlier vs later qualifications</h4><p>Coverage can change between periods. This is an observed comparison, not proof of a strategy change.</p>{[ [trend.recent.earlyLabel,trend.recent.early], [trend.recent.lateLabel,trend.recent.late] ].map(([label,period]) => { const sample = period as typeof trend.recent.early; return <div key={String(label)}><span>{String(label)}</span><strong>{sample.value === null ? "Not recorded" : trend.mean !== null ? `${sample.value.toFixed(2)}${metric.unit ? ` ${metric.unit}` : ""}` : `${Math.round(sample.value * 100)}% ${trend.noClimb ? "climbed" : "yes"}`}</strong><small>{sample.answered} answers</small></div>; })}</div> : null}
        <details><summary data-disclosure>Contributing answers</summary><div className={styles.scroll} tabIndex={0} role="region" aria-label="Trend contributing answers"><table><caption>{metric.label} · original robot-match outcomes</caption><thead><tr><th scope="col">Robot</th><th scope="col">Match</th><th scope="col">Answer</th></tr></thead><tbody>{trend.rows.map(row => <tr key={`${row.teamKey}:${row.matchKey}`}><td>{row.teamKey?.replace(/^frc/, "")}</td><td>{row.matchKey?.split("_").at(-1)}</td><td>{typeof row.payload[metric.key] === "number" ? Number(row.payload[metric.key]).toFixed(2) : scoutOptionLabel(String(row.payload[metric.key]))}</td></tr>)}</tbody></table></div></details>
      </>}
      <p className={styles.footnote}>{trend.reports} reports reduced to {trend.total} robot-matches · {trend.disagreements} disagreements for this metric. Numeric duplicates are averaged within a robot-match; tied outcome disagreements remain unknown. {includeLow ? "Low-confidence reports included." : "Low-confidence reports excluded."}</p>
    </>}
  </section>;
}
