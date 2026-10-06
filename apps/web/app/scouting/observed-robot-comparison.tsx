"use client";

import { useMemo, useState } from "react";
import type { ObservedRobot } from "../../lib/scouting/team-profiles";
import { buildScoutBreakdown, type FieldBreakdown } from "../../lib/scouting/scout-breakdown";
import { scopeObservations } from "../../lib/scouting/observation-scope";
import { scoutOptionLabel } from "../../lib/scouting/option-label";
import styles from "./observed-robot-comparison.module.css";

function MetricValue({ field }: { field: FieldBreakdown | undefined }) {
  if (!field) return <span className="app-muted">Not recorded</span>;
  if (field.kind === "number") return <><strong>{field.mean.toFixed(2)}{field.evidence.unit ? ` ${field.evidence.unit}` : ""}</strong><small>{field.evidence.answered} matches · {field.min.toFixed(1)}–{field.max.toFixed(1)} range{field.evidence.disagreements ? ` · ${field.evidence.disagreements} disagreements` : ""}</small></>;
  if (field.kind === "rate") return <><strong>{Math.round(field.rate * 100)}% yes</strong><small>{field.yes} of {field.total} observed matches</small></>;
  return <><strong>{scoutOptionLabel(field.options[0]?.value ?? "Not recorded")}</strong><small>{field.options.map(option => `${scoutOptionLabel(option.value)}: ${option.count}/${field.total}`).join(" · ")}</small></>;
}

/** Uses the same actual-report reduction and confidence filters as robot details. */
export function ObservedRobotComparison({ robots, eventKey }: { robots: ObservedRobot[]; eventKey: string | null }) {
  const [selected, setSelected] = useState<string[]>(() => robots.slice(0, 2).map(robot => robot.teamKey));
  const [includeLow, setIncludeLow] = useState(false);
  const [query, setQuery] = useState("");
  const comparisons = useMemo(() => robots.filter(robot => selected.includes(robot.teamKey)).map(robot => ({ teamKey: robot.teamKey, breakdown: buildScoutBreakdown(scopeObservations(robot.reports, eventKey ?? "", "", includeLow)) })), [robots, selected, eventKey, includeLow]);
  const metrics = new Map<string, string>();
  for (const robot of comparisons) for (const field of robot.breakdown.fields) metrics.set(field.key, field.label);
  const filtered = [...metrics].filter(([, label]) => label.toLowerCase().includes(query.trim().toLowerCase()));
  return <details className={styles.comparison}>
    <summary data-disclosure>Compare recorded capabilities</summary>
    <p className="app-muted">Choose up to three robots. Each match receives equal weight; duplicate scout reports are combined within the match. These observations do not require a scoring formula.</p>
    <fieldset className={styles.robots}><legend>Robots to compare</legend>{[...robots].sort((a, b) => Number(a.teamKey.replace(/^frc/i, "")) - Number(b.teamKey.replace(/^frc/i, ""))).map(robot => <label key={robot.teamKey}>
      <input type="checkbox" checked={selected.includes(robot.teamKey)} disabled={!selected.includes(robot.teamKey) && selected.length >= 3} onChange={() => setSelected(current => current.includes(robot.teamKey) ? current.filter(key => key !== robot.teamKey) : [...current, robot.teamKey].slice(0, 3))} />Team {robot.teamKey.replace(/^frc/i, "")}
    </label>)}</fieldset>
    <div className={styles.filters}><label>Find a metric<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Fuel, climb, defense…" /></label>
      <label><input type="checkbox" checked={includeLow} onChange={event => setIncludeLow(event.target.checked)} />Include low-confidence reports</label></div>
    {comparisons.length >= 2 ? filtered.length ? <div className={styles.scroll} role="region" aria-label="Robot capability comparison" tabIndex={0}><table>
      <caption>Recorded averages and rates{eventKey ? ` · ${eventKey}` : " · all recorded events"}</caption>
      <thead><tr><th scope="col">Metric</th>{comparisons.map(robot => <th scope="col" key={robot.teamKey}>Team {robot.teamKey.replace(/^frc/i, "")}<small>{robot.breakdown.matches} matches watched</small></th>)}</tr></thead>
      <tbody>{filtered.map(([key, label]) => <tr key={key}><th scope="row">{label}</th>{comparisons.map(robot => <td key={robot.teamKey}><MetricValue field={robot.breakdown.fields.find(field => field.key === key)} /></td>)}</tr>)}</tbody>
    </table></div> : <p>No matching observed metrics. Missing answers never become zero.</p> : <p>Select at least two robots to compare their observed capabilities.</p>}
    <p className="app-muted">Open a robot’s capability metric below to inspect its contributing reports and disagreements.</p>
  </details>;
}
