"use client";

import { useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";

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

type CompareResult = {
  teams: Array<{ teamNumber: number; nickname: string | null; teamKey: string }>;
  headToHead: Array<{
    dimension: string;
    a: number | null;
    b: number | null;
    advantage: "a" | "b" | "even" | "unknown";
  }>;
  chemistry: {
    score: number | null;
    caveat: string;
    caveats?: string[];
    strengths?: string[];
    risks?: string[];
  } | null;
};

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default function IntelClient({ orgId }: { orgId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchTeam[]>([]);
  const [intel, setIntel] = useState<Intel | null>(null);
  const [similar, setSimilar] = useState<Array<SearchTeam & { epaTotal: number }>>([]);
  const [summary, setSummary] = useState("");
  const [compare, setCompare] = useState("");
  const [comparison, setComparison] = useState<CompareResult | null>(null);
  const [pickEvent, setPickEvent] = useState("");
  const [pickName, setPickName] = useState("Primary pick list");
  const [status, setStatus] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  const [submitting, setSubmitting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Searching global team index…");
    const response = await fetch(`/api/intel/teams?orgId=${orgId}&q=${encodeURIComponent(query)}`);
    const data = await response.json();
    setResults(data.teams ?? []);
    setStatus(response.ok ? "" : data.error);
    setMessageKind(response.ok ? "success" : "error");
  }

  async function select(teamNumber: number) {
    setStatus(`Loading Team ${teamNumber}…`);
    const response = await fetch(`/api/intel/teams?orgId=${orgId}&team=${teamNumber}`);
    const data = await response.json();
    setIntel(data.team ?? null);
    setSimilar(data.similarTeams ?? []);
    setSummary("");
    setComparison(null);
    setStatus(response.ok ? "" : data.error);
    setMessageKind(response.ok ? "success" : "error");
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
    setMessageKind(response.ok ? "success" : "error");
    if (response.ok && path.includes("research")) await select(intel.team.teamNumber);
  }

  async function runComparison(event: React.FormEvent) {
    event.preventDefault();
    const numbers = compare
      .split(/[,\s]+/)
      .map(Number)
      .filter(Number.isInteger);
    if (intel && !numbers.includes(intel.team.teamNumber)) numbers.unshift(intel.team.teamNumber);
    setSubmitting(true);
    const response = await fetch("/api/intel/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, teamNumbers: numbers.slice(0, 3) }),
    });
    const data = await response.json();
    setComparison(response.ok ? (data as CompareResult) : null);
    setStatus(response.ok ? "" : data.error);
    setMessageKind(response.ok ? "success" : "error");
    setSubmitting(false);
  }

  async function savePick() {
    if (!intel) return;
    if (!pickEvent) {
      setStatus("Enter an event key first");
      setMessageKind("error");
      return;
    }
    setSubmitting(true);
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
    setMessageKind(response.ok ? "success" : "error");
    setSubmitting(false);
  }

  const metric = intel?.metrics[0];

  return (
    <main className="module-page intel-page">
      <PageHeader
        breadcrumbs="Competition / Matches"
        title="Team Intel"
        description="Search the global team index. Metrics stay blank until TBA/Statbotics data exists — never fabricated."
      >
        <a className="app-button secondary" href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>
          Open scouting
        </a>
      </PageHeader>

      <Panel as="form" className="intel-lookup" onSubmit={search} style={{ minHeight: "auto" }}>
        <FormRow label="Global team lookup" hint="Teams at your active event appear first.">
          <div className="intel-lookup-row">
            <input
              id="team-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Team number, nickname, or name"
            />
            <button type="submit" className="app-button">
              Search
            </button>
          </div>
        </FormRow>
      </Panel>

      {status ? (
        <div className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {status}
        </div>
      ) : null}

      {results.length > 0 ? (
        <section className="intel-results" aria-label="Team search results">
          {results.map((team) => (
            <button key={team.teamKey} type="button" onClick={() => void select(team.teamNumber)}>
              <strong>{team.teamNumber}</strong>
              <span>{team.nickname ?? "Unnamed team"}</span>
              {team.atActiveEvent ? <em>At active event</em> : null}
              <small className="app-muted">{[team.city, team.stateProv].filter(Boolean).join(", ")}</small>
            </button>
          ))}
        </section>
      ) : null}

      {!intel && results.length === 0 ? (
        <EmptyState
          soft
          title="Look up a team"
          description="Search by number or name to open metrics, research, and dossier links. Empty cells mean the cache has no data yet."
        />
      ) : null}

      {intel ? (
        <div className="intel-detail">
          <Panel className="intel-hero-card" style={{ minHeight: "auto" }}>
            <header className="intel-hero-head">
              <div>
                <span className="app-badge">Team {intel.team.teamNumber}</span>
                <h2>{intel.team.nickname ?? intel.team.name}</h2>
                <p className="app-muted">
                  {[intel.team.city, intel.team.stateProv, intel.team.country].filter(Boolean).join(" · ")}
                  {intel.atActiveEvent ? " · at active event" : ""}
                </p>
              </div>
              <div className="intel-primary-actions">
                <a
                  className="app-button secondary"
                  href={`/dossier?orgId=${encodeURIComponent(orgId)}&team=${intel.team.teamNumber}`}
                >
                  Season dossier
                </a>
                <button
                  type="button"
                  className="app-button"
                  onClick={() => void action("/api/intel/summary", "Generating metered brief…")}
                >
                  Plain-English brief
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  onClick={() => void action("/api/research", "Running metered research…")}
                >
                  Research
                </button>
              </div>
            </header>
          </Panel>

          {summary ? (
            <Panel style={{ minHeight: "auto" }}>
              <span className="app-badge">Metered brief</span>
              <p style={{ margin: "10px 0 0" }}>{summary}</p>
            </Panel>
          ) : null}

          <section className="intel-metric-grid" aria-label="Team metrics">
            {(
              [
                ["Total EPA", metric?.epaTotal],
                ["Auto", metric?.epaAuto],
                ["Teleop", metric?.epaTeleop],
                ["Endgame", metric?.epaEndgame],
                ["Reliability", intel.reliability.score],
                ["Consistency", intel.reliability.consistency],
              ] as const
            ).map(([label, value]) => (
              <Panel key={label} style={{ minHeight: "auto", textAlign: "center" }}>
                <span className="app-muted">{label}</span>
                <strong style={{ display: "block", fontSize: "1.6rem", letterSpacing: "-0.03em" }}>
                  {fmt(value)}
                </strong>
              </Panel>
            ))}
          </section>

          <div className="intel-panels">
            <Panel>
              <h3 style={{ marginTop: 0 }}>Robot profile</h3>
              <div className="intel-tag-row">
                {intel.archetypes.length ? (
                  intel.archetypes.map((tag) => (
                    <span key={tag} className="app-badge">
                      {tag}
                    </span>
                  ))
                ) : (
                  <p className="app-muted">Insufficient data for archetypes.</p>
                )}
              </div>
              <h4>Reliability</h4>
              <p className="app-muted">{intel.reliability.evidence}</p>
              <h4>Foul risk: {intel.foulRisk.level}</h4>
              <p className="app-muted">{intel.foulRisk.evidence}</p>
            </Panel>

            <Panel>
              <h3 style={{ marginTop: 0 }}>Trajectory</h3>
              {intel.trajectory.length ? (
                <ul className="intel-trajectory">
                  {intel.trajectory.map((point) => (
                    <li key={point.year}>
                      <span>{point.year}</span>
                      <i style={{ width: `${Math.max(4, Math.min(100, 50 + point.epa))}%` }} aria-hidden />
                      <strong>{point.epa.toFixed(1)}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted">No year metrics in cache yet.</p>
              )}
            </Panel>

            <Panel>
              <h3 style={{ marginTop: 0 }}>Similar teams</h3>
              {similar.length ? (
                <ul className="intel-similar">
                  {similar.map((team) => (
                    <li key={team.teamKey}>
                      <button type="button" onClick={() => void select(team.teamNumber)}>
                        <b>{team.teamNumber}</b>
                        <span>{team.nickname}</span>
                        <em>{team.epaTotal.toFixed(1)} EPA</em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="app-muted">No comparable year metrics.</p>
              )}
            </Panel>
          </div>

          <Panel>
            <h3 style={{ marginTop: 0 }}>Source-linked research</h3>
            <p className="app-muted">Web findings are context, never hard performance data.</p>
            {intel.findings.length ? (
              <ul className="intel-findings">
                {intel.findings.map((finding) => (
                  <li key={finding.id}>
                    <div>
                      <span className="app-badge">{finding.sourceType.replace("_", " ")}</span>
                      <strong>{Math.round(finding.confidence * 100)}% confidence</strong>
                    </div>
                    <p>{finding.summary}</p>
                    <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
                      {finding.sourceTitle ?? new URL(finding.sourceUrl).hostname} ↗
                    </a>
                    <small className="app-muted">
                      {new Date(finding.publishedAt ?? finding.foundAt).toLocaleDateString()}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No research findings yet. Use Research above to run a metered sweep.</p>
            )}
          </Panel>

          <Panel style={{ minHeight: "auto" }}>
            <button type="button" className="text-button" onClick={() => setToolsOpen((open) => !open)}>
              {toolsOpen ? "Hide compare & pick tools" : "Compare alliance / save pick"}
            </button>
            {toolsOpen ? (
              <div className="intel-tools">
                <form onSubmit={runComparison}>
                  <FormRow label="Compare with 1–2 more teams" hint="Includes the selected team automatically.">
                    <div className="intel-lookup-row">
                      <input
                        value={compare}
                        onChange={(e) => setCompare(e.target.value)}
                        placeholder="e.g. 1678, 118"
                        aria-label="Team numbers to compare"
                      />
                      <button type="submit" className="app-button secondary" disabled={submitting}>
                        Compare
                      </button>
                    </div>
                  </FormRow>
                </form>

                {comparison ? (
                  <div className="intel-compare-result">
                    <p>
                      <strong>Teams:</strong>{" "}
                      {comparison.teams.map((t) => t.teamNumber).join(" · ")}
                    </p>
                    {comparison.headToHead?.length ? (
                      <ul className="intel-h2h">
                        {comparison.headToHead.map((row) => (
                          <li key={row.dimension}>
                            <span>{row.dimension}</span>
                            <strong>
                              {fmt(row.a)} vs {fmt(row.b)}
                            </strong>
                            <em className="app-muted">{row.advantage}</em>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {comparison.chemistry ? (
                      <p>
                        <span className="app-badge setup">MODEL</span> Chemistry{" "}
                        <strong>{comparison.chemistry.score ?? "—"}</strong>
                        {comparison.chemistry.caveat || comparison.chemistry.caveats?.[0] ? (
                          <span className="app-muted">
                            {" "}
                            — {comparison.chemistry.caveat || comparison.chemistry.caveats?.[0]}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    <a
                      className="text-button"
                      href={`/chemistry?orgId=${encodeURIComponent(orgId)}&teams=${comparison.teams
                        .map((t) => t.teamNumber)
                        .join(",")}`}
                    >
                      Open Alliance Chemistry →
                    </a>
                  </div>
                ) : null}

                <div className="intel-pick-row">
                  <FormRow label="Event key">
                    <input
                      value={pickEvent}
                      onChange={(e) => setPickEvent(e.target.value)}
                      placeholder="Event key"
                      aria-label="Event key"
                    />
                  </FormRow>
                  <FormRow label="Pick list name">
                    <input
                      value={pickName}
                      onChange={(e) => setPickName(e.target.value)}
                      aria-label="Pick list name"
                    />
                  </FormRow>
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => void savePick()}
                    disabled={submitting}
                  >
                    Save as #1 pick
                  </button>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </main>
  );
}
