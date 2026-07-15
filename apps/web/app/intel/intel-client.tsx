"use client";

import { useState } from "react";

type SearchTeam = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  city: string | null;
  stateProv: string | null;
  atActiveEvent: boolean;
};
type Intel = {
  team: SearchTeam & { name: string; country: string | null; rookieYear: number | null };
  atActiveEvent: boolean;
  metrics: Array<{
    eventKey?: string;
    year: number;
    epaTotal: number | null;
    epaAuto: number | null;
    epaTeleop: number | null;
    epaEndgame: number | null;
    source: string;
  }>;
  findings: Array<{
    id: string;
    sourceUrl: string;
    sourceTitle: string | null;
    sourceType: string;
    summary: string;
    confidence: number;
    publishedAt: string | null;
    foundAt: string;
  }>;
  trajectory: Array<{ year: number; epa: number }>;
  archetypes: string[];
  reliability: { score: number | null; consistency: number | null; sampleSize: number; evidence: string };
  foulRisk: { level: string; rate: number | null; sampleSize: number; evidence: string };
};

export default function IntelClient({ orgId }: { orgId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTeam[]>([]);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [similar, setSimilar] = useState<Array<SearchTeam & { epaTotal: number }>>([]);
  const [summary, setSummary] = useState("");
  const [compare, setCompare] = useState("");
  const [comparison, setComparison] = useState<Record<string, unknown> | null>(null);
  const [pickEvent, setPickEvent] = useState("");
  const [pickName, setPickName] = useState("Primary pick list");
  const [status, setStatus] = useState("");

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Searching global team index…");
    const response = await fetch(`/api/intel/teams?orgId=${orgId}&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    setResults(data.teams ?? []);
    setStatus(response.ok ? "" : data.error);
  }

  async function select(teamNumber: number) {
    setStatus(`Loading Team ${teamNumber}…`);
    const response = await fetch(`/api/intel/teams?orgId=${orgId}&team=${teamNumber}`);
    const data = await response.json();
    setIntel(data.team ?? null);
    setSimilar(data.similarTeams ?? []);
    setSummary("");
    setStatus(response.ok ? "" : data.error);
  }

  async function action(path: string, label: string) {
    if (!intel) return;
    setStatus(label);
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, teamNumber: intel.team.teamNumber }),
    });
    const data = await response.json();
    if (path.includes("summary") && data.summary) setSummary(data.summary);
    setStatus(response.ok ? (path.includes("research") ? "Research sweep completed." : "") : data.error);
    if (response.ok && path.includes("research")) await select(intel.team.teamNumber);
  }

  async function runComparison(event: React.FormEvent) {
    event.preventDefault();
    const numbers = compare.split(/[,\s]+/).map(Number).filter(Number.isInteger);
    if (intel && !numbers.includes(intel.team.teamNumber)) numbers.unshift(intel.team.teamNumber);
    const response = await fetch("/api/intel/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, teamNumbers: numbers.slice(0, 3) }),
    });
    const data = await response.json();
    setComparison(response.ok ? data : null);
    setStatus(response.ok ? "" : data.error);
  }

  async function savePick() {
    if (!intel || !pickEvent) return;
    const response = await fetch("/api/intel/pick-lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId,
        eventKey: pickEvent,
        name: pickName,
        entries: [{ teamKey: intel.team.teamKey, rank: 1, tier: "review" }],
      }),
    });
    const data = await response.json();
    setStatus(response.ok ? `Saved ${intel.team.teamNumber} to ${pickName}.` : data.error);
  }

  const metric = intel?.metrics[0];
  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / TEAM INTEL</span><h1>Competition intelligence</h1></div>
        <a href={`/scouting?orgId=${orgId}`}>Open scouting →</a>
      </header>
      <form className="intel-search" onSubmit={search}>
        <label htmlFor="team-search">Global team lookup</label>
        <div><input id="team-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Team number, nickname, or name" /><button>Search</button></div>
        <small>Teams at your active event appear first.</small>
      </form>
      {status && <div className="telemetry-status" role="status">{status}</div>}
      {results.length > 0 && (
        <section className="team-results" aria-label="Team search results">
          {results.map((team) => (
            <button key={team.teamKey} onClick={() => select(team.teamNumber)}>
              <strong>{team.teamNumber}</strong><span>{team.nickname ?? "Unnamed team"}</span>
              {team.atActiveEvent && <em>AT ACTIVE EVENT</em>}
              <small>{[team.city, team.stateProv].filter(Boolean).join(", ")}</small>
            </button>
          ))}
        </section>
      )}
      {intel && (
        <>
          <section className="intel-hero">
            <div><span className="eyebrow">TEAM {intel.team.teamNumber}</span><h2>{intel.team.nickname ?? intel.team.name}</h2>
              <p>{[intel.team.city, intel.team.stateProv, intel.team.country].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="intel-actions">
              <button onClick={() => action("/api/intel/summary", "Generating metered brief…")}>Generate plain-English brief</button>
              <button onClick={() => action("/api/research", "Running metered research…")}>Research this team</button>
            </div>
          </section>
          {summary && <section className="intel-brief"><span className="eyebrow">METERED VANTAGE BRIEF</span><p>{summary}</p></section>}
          <section className="metric-grid">
            {[
              ["Total EPA", metric?.epaTotal], ["Auto", metric?.epaAuto],
              ["Teleop", metric?.epaTeleop], ["Endgame", metric?.epaEndgame],
              ["Reliability", intel.reliability.score], ["Consistency", intel.reliability.consistency],
            ].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{typeof value === "number" ? value.toFixed(1) : "—"}</strong></article>)}
          </section>
          <section className="intel-grid">
            <article className="intel-panel"><span className="eyebrow">ROBOT PROFILE</span><h3>Archetypes</h3>
              <div className="tag-row">{intel.archetypes.length ? intel.archetypes.map((tag) => <span key={tag}>{tag}</span>) : <p>Insufficient data</p>}</div>
              <h3>Reliability evidence</h3><p>{intel.reliability.evidence}</p>
              <h3>Foul risk: {intel.foulRisk.level}</h3><p>{intel.foulRisk.evidence}</p>
            </article>
            <article className="intel-panel"><span className="eyebrow">HISTORICAL TRAJECTORY</span>
              <div className="trajectory">{intel.trajectory.map((point) => <div key={point.year}><span>{point.year}</span><i style={{ width: `${Math.max(4, Math.min(100, 50 + point.epa))}%` }} /><strong>{point.epa.toFixed(1)}</strong></div>)}</div>
            </article>
            <article className="intel-panel"><span className="eyebrow">SIMILAR TEAMS</span>
              {similar.length ? similar.map((team) => <button className="similar-team" key={team.teamKey} onClick={() => select(team.teamNumber)}><b>{team.teamNumber}</b><span>{team.nickname}</span><em>{team.epaTotal.toFixed(1)} EPA</em></button>) : <p>No comparable year metrics.</p>}
            </article>
          </section>
          <section className="research-panel"><div><span className="eyebrow">QUALITATIVE RESEARCH</span><h3>Source-linked findings</h3><p>Web findings are context, never hard performance data.</p></div>
            {intel.findings.length ? intel.findings.map((finding) => <article key={finding.id}><div><span>{finding.sourceType.replace("_", " ")}</span><strong>{Math.round(finding.confidence * 100)}% confidence</strong></div><p>{finding.summary}</p><a href={finding.sourceUrl} target="_blank" rel="noreferrer">{finding.sourceTitle ?? new URL(finding.sourceUrl).hostname} ↗</a><small>{new Date(finding.publishedAt ?? finding.foundAt).toLocaleDateString()}</small></article>) : <p>No research findings yet.</p>}
          </section>
          <section className="compare-panel"><div><span className="eyebrow">HEAD-TO-HEAD + CHEMISTRY</span><h3>Compare an alliance</h3></div>
            <form onSubmit={runComparison}><input value={compare} onChange={(e) => setCompare(e.target.value)} placeholder="Add 1–2 team numbers" /><button>Compare</button></form>
            {comparison && <pre>{JSON.stringify(comparison, null, 2)}</pre>}
          </section>
          <section className="compare-panel"><div><span className="eyebrow">PICK LISTS / DURABLE</span><h3>Start an event pick list</h3></div>
            <div className="pick-controls"><input value={pickEvent} onChange={(e) => setPickEvent(e.target.value)} placeholder="Event key" /><input value={pickName} onChange={(e) => setPickName(e.target.value)} aria-label="Pick list name" /><button onClick={savePick}>Save current team as #1</button></div>
          </section>
        </>
      )}
    </main>
  );
}
