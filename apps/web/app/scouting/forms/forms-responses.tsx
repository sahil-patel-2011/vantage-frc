"use client";
import { useEffect, useState } from "react";
import { isLayoutOnlyField } from "@vantage/scouting";
import { Button, relativeTime, StatTile, ToolStrip } from "../../../components/ui";
import { matchLabelFromKey } from "../../../lib/matches/no-next-match";
import {
  responseOverview, responsesByScout, responseSummary, responseValue, responsesCsv,
} from "../../../lib/scouting/form-response-summary";
import { FormResponsesError, loadFormResponses, type FormResponseData } from "../../../lib/scouting/form-response-data";
import { signInHref } from "../../../lib/ui/load-failure";

const teamNumber = (team: string) => team.replace(/^frc/, "");

export function FormsResponses({ orgId, schemaId }: { orgId: string; schemaId?: string }) {
  const scope = `${orgId}:${schemaId ?? ""}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; data: FormResponseData; loadedAt: string } | null>(null);
  const data = snapshot?.scope === scope ? snapshot.data : null;
  const [issue, setIssue] = useState<{ scope: string; message: string; status: number | null } | null>(null);
  const error = issue?.scope === scope ? issue.message : "";
  const errorStatus = issue?.scope === scope ? issue.status : null;
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("summary");
  const [team, setTeam] = useState("");
  const [scout, setScout] = useState("");
  useEffect(() => {
    if (!schemaId) return;
    const formId = schemaId;
    const lifecycle = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      setRefreshing(true);
      try {
        const body = await loadFormResponses(orgId, formId, AbortSignal.any([lifecycle.signal, AbortSignal.timeout(10_000)]));
        if (!lifecycle.signal.aborted) { setSnapshot({ scope, data: body, loadedAt: new Date().toISOString() }); setIssue(null); }
      } catch (cause) {
        if (!lifecycle.signal.aborted) {
          if (cause instanceof FormResponsesError && cause.discardPrevious) setSnapshot(null);
          setIssue({ scope, status: cause instanceof FormResponsesError ? cause.status : null,
            message: cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Responses took too long to load. Try again." });
        }
      } finally { loading = false; if (!lifecycle.signal.aborted) setRefreshing(false); }
    }
    setIssue(null); void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 15_000);
    const resume = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", resume);
    return () => { lifecycle.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [orgId, schemaId, scope, attempt]);
  if (!schemaId) return <p>Publish this form to collect and review responses.</p>;
  if (!data) return <div className="sfb-response-loading"><p role={error ? "alert" : "status"}>{error || "Loading responses…"}</p>
    {errorStatus === 401 ? <Button as="a" variant="primary" href={signInHref(`${window.location.pathname}${window.location.search}`)}>Sign in again</Button> : error ? <Button type="button" variant="secondary" disabled={refreshing} onClick={() => setAttempt(current => current + 1)}>Retry responses</Button> : null}</div>;
  const fields = data.definition.fields.filter(field => !isLayoutOnlyField(field));
  const scouts = data.scouts;
  const responseView = view === "scouts" && !scouts ? "summary" : view;
  const selectedScout = scouts && responseView !== "scouts" ? scout : "";
  const teamRows = data.rows.filter(row => !team.trim() || teamNumber(row.team).includes(team.trim()));
  const rows = teamRows.filter(row => !selectedScout || row.scoutId === selectedScout);
  const overview = responseOverview(rows);
  const reportingScouts = new Set(rows.flatMap(row => row.scoutId ? [row.scoutId] : [])).size;
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
      {scouts ? <StatTile label="Scouts reporting" value={reportingScouts} /> : <StatTile label="Filed by you" value={overview.mine} />}
      {overview.latest ? <StatTile label="Latest response" value={relativeTime(overview.latest)} /> : null}
    </div> : null}
    <div className="sfb-response-controls"><ToolStrip presentation="segments" aria-label="Response view" value={responseView} onChange={setView} items={[{ id: "summary", label: "Summary" }, { id: "table", label: "Table" }, ...(scouts ? [{ id: "scouts", label: "By scout" }] : [])]} />
      <div className="sfb-response-filters">
        <label>Team number<input inputMode="numeric" value={team} placeholder="All teams" onChange={event => setTeam(event.target.value.replace(/\D/g, ""))} /></label>
        {scouts && responseView !== "scouts" ? <label>Scout<select aria-label="Scout" value={scout} onChange={event => setScout(event.target.value)}><option value="">Everyone</option>{scouts.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label> : null}
      </div></div>
    {error ? <div className="sfb-response-loading"><p role="alert">{error} Showing responses last loaded {relativeTime(snapshot!.loadedAt)}.</p>
      <Button type="button" variant="secondary" disabled={refreshing} onClick={() => setAttempt(current => current + 1)}>Retry responses</Button></div> : null}
    {data.hasMore ? <p>Showing the latest 500 responses.</p> : null}
    {responseView === "scouts" && scouts ? <div className="sfb-scouts">
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
    </div> : !rows.length ? <p>{data.rows.length ? "No responses match these filters." : "No responses yet. Open scouting to record the first robot."}</p> : responseView === "table" ?
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
