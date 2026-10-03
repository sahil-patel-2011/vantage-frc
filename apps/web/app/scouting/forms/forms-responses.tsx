"use client";
import { useEffect, useState } from "react";
import { isLayoutOnlyField, type SchemaDefinition } from "@vantage/scouting";
import { Button, relativeTime, StatTile, ToolStrip } from "../../../components/ui";
import { matchLabelFromKey } from "../../../lib/matches/no-next-match";
import {
  responseOverview, responsesByScout, responseSummary, responseValue, responsesCsv,
  type FormResponseRow, type ScoutTotal,
} from "../../../lib/scouting/form-response-summary";

/** `scouts` and `idle` are null unless the reader is a team lead. */
type Data = { definition: SchemaDefinition; rows: FormResponseRow[]; hasMore: boolean; scouts: ScoutTotal[] | null; idle: string[] | null };
const teamNumber = (team: string) => team.replace(/^frc/, "");

export function FormsResponses({ orgId, schemaId }: { orgId: string; schemaId?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState("summary");
  const [team, setTeam] = useState("");
  const [scout, setScout] = useState("");
  useEffect(() => {
    if (!schemaId) return;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(`/api/scouting/form-responses?orgId=${encodeURIComponent(orgId)}&schemaId=${schemaId}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load responses.");
        if (!controller.signal.aborted) { setData(body); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load responses."); }
      finally { loading = false; }
    }
    setData(null); void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [orgId, schemaId]);
  if (!schemaId) return <p>Publish this form to collect and review responses.</p>;
  if (!data) return <p role={error ? "alert" : "status"}>{error || "Loading responses…"}</p>;
  const fields = data.definition.fields.filter(field => !isLayoutOnlyField(field));
  const scouts = data.scouts;
  const teamRows = data.rows.filter(row => !team.trim() || teamNumber(row.team).includes(team.trim()));
  const rows = teamRows.filter(row => !scout || row.scoutId === scout);
  const overview = responseOverview(rows);
  const byScout = scouts ? responsesByScout(scouts, teamRows, Boolean(team.trim())) : [];
  const most = Math.max(...byScout.map(entry => entry.count), 1);
  return <section className="sfb-responses" aria-label="Form responses">
    <header><div><h2>{rows.length} {rows.length === 1 ? "response" : "responses"}</h2><p>This team’s saved answers, including earlier form versions. Blank answers stay blank.</p></div>
      <Button type="button" variant="secondary" disabled={!rows.length} onClick={() => {
        const url = URL.createObjectURL(new Blob([responsesCsv(fields, rows)], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href=url; link.download="scouting-responses.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export CSV</Button></header>
    {rows.length ? <div className="sfb-response-stats" role="group" aria-label="Response overview">
      <StatTile label="Robots covered" value={overview.teams} />
      {scouts ? <StatTile label="Scouts reporting" value={byScout.length} /> : <StatTile label="Filed by you" value={overview.mine} />}
      {overview.latest ? <StatTile label="Latest response" value={relativeTime(overview.latest)} /> : null}
    </div> : null}
    <div className="sfb-response-controls"><ToolStrip presentation="segments" aria-label="Response view" value={view} onChange={setView} items={[{ id: "summary", label: "Summary" }, { id: "table", label: "Table" }, ...(scouts ? [{ id: "scouts", label: "By scout" }] : [])]} />
      <div className="sfb-response-filters">
        <label>Team number<input inputMode="numeric" value={team} placeholder="All teams" onChange={event => setTeam(event.target.value.replace(/\D/g, ""))} /></label>
        {scouts && view !== "scouts" ? <label>Scout<select value={scout} onChange={event => setScout(event.target.value)}><option value="">Everyone</option>{scouts.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label> : null}
      </div></div>
    {error ? <p role="alert">{error}</p> : null}
    {data.hasMore ? <p>Showing the latest 500 responses.</p> : null}
    {view === "scouts" && scouts ? <div className="sfb-scouts">
      {!byScout.length ? <p>{team.trim() ? "Nobody has scouted that team with this form yet." : "No responses yet. Open scouting to record the first robot."}</p> :
        <ol className="sfb-scout-list">{byScout.map(entry => <li key={entry.id}><details>
          <summary><span className="sfb-scout-name">{entry.name}</span>
            <meter aria-hidden="true" min={0} max={most} value={entry.count} />
            <strong>{entry.count}<span className="sr-only"> {entry.count === 1 ? "response" : "responses"}</span></strong>
            <small>{entry.teams} {entry.teams === 1 ? "robot" : "robots"} · last {relativeTime(entry.lastAt)}</small></summary>
          <ul>{entry.rows.map(row => <li key={row.id}><span>Team {teamNumber(row.team)}</span><span>{matchLabelFromKey(row.label)}</span><time dateTime={row.observedAt}>{new Date(row.observedAt).toLocaleString()}</time></li>)}</ul>
          {entry.rows.length < entry.count ? <p>Showing {entry.rows.length} of {entry.count}. Export CSV has the latest 500 responses.</p> : null}
          <Button type="button" variant="secondary" onClick={() => { setScout(entry.id); setView("table"); }}>See their answers</Button>
        </details></li>)}</ol>}
      {data.idle?.length && !team.trim() ? <p className="sfb-scout-idle">No response to this form yet from {data.idle.join(", ")}.</p> : null}
    </div> : !rows.length ? <p>{data.rows.length ? "No responses match these filters." : "No responses yet. Open scouting to record the first robot."}</p> : view === "table" ?
      <div className="sfb-response-table" role="region" aria-label="Scouting response table"><table tabIndex={0} aria-label="Scouting responses"><thead><tr><th scope="col">Team</th><th scope="col">Report</th>{scouts ? <th scope="col">Scout</th> : null}{fields.map(field => <th scope="col" key={field.key}>{field.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><th scope="row">{teamNumber(row.team)}</th><td>{matchLabelFromKey(row.label)}<small>{new Date(row.observedAt).toLocaleString()}</small></td>{scouts ? <td>{row.scout}</td> : null}{fields.map(field => <td key={field.key}>{responseValue(row.payload[field.key])}</td>)}</tr>)}</tbody></table></div> :
      <div className="sfb-response-charts">{fields.map(field => {
        const summary = responseSummary(field, rows);
        if (summary.chart === "none") return null;
        const max = Math.max(...summary.numeric, 1), min = Math.min(...summary.numeric, 0), range = max-min || 1;
        return <article key={field.key}><h3>{field.label}</h3><p>{summary.n} answered{summary.mean !== null ? ` · Average ${summary.mean.toFixed(1)}` : ""}</p>
          {summary.chart === "trend" && summary.numeric.length > 1 ? <svg viewBox="0 0 300 100" role="img" aria-label={`${field.label}, oldest to newest: ${summary.numeric.join(", ")}`}><polyline fill="none" stroke="var(--accent)" strokeWidth="3" points={summary.numeric.map((n,i) => `${8+i*284/(summary.numeric.length-1)},${92-(n-min)*84/range}`).join(" ")} /></svg> : <ul>{summary.counts.slice(0,12).map(([label,count]) => <li key={label}><span>{label}</span><meter aria-label={`${label}: ${count} answers`} min={0} max={Math.max(summary.n,1)} value={count} /><strong>{count}</strong></li>)}</ul>}</article>;
      })}</div>}
  </section>;
}
