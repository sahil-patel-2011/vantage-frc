"use client";

import { type FormEvent } from "react";
import { FormRow, Panel, Button } from "../../components/ui";
import {
  intelScoutNoteLines,
  intelSourceTypeLabel,
  type IntelActiveEvent,
  type IntelNextAction,
  type IntelScoutNote,
} from "../../lib/intel/intel-related";
import { IntelNextActionsPanel } from "./intel-chrome";

export type IntelSearchTeam = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  city: string | null;
  stateProv: string | null;
  atActiveEvent: boolean;
};

export type IntelDetail = {
  team: IntelSearchTeam & { name: string; country: string | null; rookieYear: number | null };
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

export type IntelCompareResult = {
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

export function IntelLookupForm({
  query,
  onQueryChange,
  onSearch,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent) => void;
}) {
  return (
    <Panel as="form" className="intel-lookup" onSubmit={onSearch} style={{ minHeight: "auto" }}>
      <FormRow label="Look up a team" hint="Teams at your event appear first.">
        <div className="intel-lookup-row">
          <input
            id="team-search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Team number or name"
          />
          <Button variant="primary" type="submit">
            Search
          </Button>
        </div>
      </FormRow>
    </Panel>
  );
}

export function IntelSearchResults({
  results,
  onSelect,
}: {
  results: IntelSearchTeam[];
  onSelect: (teamNumber: number) => void;
}) {
  if (!results.length) return null;
  return (
    <section className="intel-results" aria-label="Team search results">
      {results.map((team) => (
        <button key={team.teamKey} type="button" onClick={() => onSelect(team.teamNumber)}>
          <strong>{team.teamNumber}</strong>
          <span>{team.nickname ?? "Unnamed team"}</span>
          {team.atActiveEvent ? <em>At your event</em> : null}
          <small className="app-muted">{[team.city, team.stateProv].filter(Boolean).join(", ")}</small>
        </button>
      ))}
    </section>
  );
}

export function IntelReadyView({
  intel,
  similar,
  summary,
  compare,
  comparison,
  pickName,
  toolsOpen,
  submitting,
  scoutNotes,
  activeEvent,
  readyActions,
  chemistryHref,
  onWriteBrief,
  onFindNotes,
  onToggleTools,
  onCompareChange,
  onCompare,
  onPickNameChange,
  onSavePick,
  onSelectSimilar,
}: {
  intel: IntelDetail;
  similar: Array<IntelSearchTeam & { epaTotal: number }>;
  summary: string;
  compare: string;
  comparison: IntelCompareResult | null;
  pickName: string;
  toolsOpen: boolean;
  submitting: boolean;
  scoutNotes: IntelScoutNote[];
  activeEvent: IntelActiveEvent | null;
  readyActions: IntelNextAction[];
  chemistryHref: string;
  onWriteBrief: () => void;
  onFindNotes: () => void;
  onToggleTools: () => void;
  onCompareChange: (value: string) => void;
  onCompare: (event: FormEvent) => void;
  onPickNameChange: (value: string) => void;
  onSavePick: () => void;
  onSelectSimilar: (teamNumber: number) => void;
}) {
  const metric = intel.metrics[0];
  const findingCount = intel.findings.length;
  const noteLines = intelScoutNoteLines(scoutNotes);
  const eventLabel = activeEvent?.eventName?.trim() || activeEvent?.eventKey || null;

  return (
    <div className="intel-detail">
      <Panel className="intel-hero-card" style={{ minHeight: "auto" }}>
        <header className="intel-hero-head">
          <div>
            <span className="app-badge">Team {intel.team.teamNumber}</span>
            <h2>{intel.team.nickname ?? intel.team.name}</h2>
            <p className="app-muted">
              {[intel.team.city, intel.team.stateProv, intel.team.country].filter(Boolean).join(" · ")}
              {intel.atActiveEvent ? " · at your event" : ""}
            </p>
          </div>
          <div className="intel-primary-actions">
            <Button variant="primary" type="button" onClick={onWriteBrief}>
              Write a brief
            </Button>
            <Button variant="secondary" type="button" onClick={onFindNotes}>
              Find public notes
            </Button>
          </div>
        </header>
      </Panel>

      {summary ? (
        <Panel style={{ minHeight: "auto" }}>
          <span className="app-badge">Brief</span>
          <p style={{ margin: "10px 0 0" }}>{summary}</p>
        </Panel>
      ) : null}

      <section className="intel-metric-grid" aria-label="Season scores">
        {(
          [
            ["Season rating", metric?.epaTotal],
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
              <p className="app-muted">Not enough scores yet to describe this robot.</p>
            )}
          </div>
          <h4>Reliability</h4>
          <p className="app-muted">{intel.reliability.evidence}</p>
          <h4>Foul risk: {intel.foulRisk.level}</h4>
          <p className="app-muted">{intel.foulRisk.evidence}</p>
        </Panel>

        <Panel>
          <h3 style={{ marginTop: 0 }}>Season path</h3>
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
            <p className="app-muted">No season scores on file yet.</p>
          )}
        </Panel>

        <Panel>
          <h3 style={{ marginTop: 0 }}>Similar teams</h3>
          {similar.length ? (
            <ul className="intel-similar">
              {similar.map((team) => (
                <li key={team.teamKey}>
                  <button type="button" onClick={() => onSelectSimilar(team.teamNumber)}>
                    <b>{team.teamNumber}</b>
                    <span>{team.nickname}</span>
                    <em>{team.epaTotal.toFixed(1)} rating</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No similar teams on file yet.</p>
          )}
        </Panel>
      </div>

      <Panel>
        <h3 style={{ marginTop: 0 }}>From our scouting</h3>
        {noteLines.length ? (
          <ul className="intel-findings">
            {noteLines.map((line) => (
              <li key={line.id}>
                <div>
                  <strong>{line.title}</strong>
                </div>
                <p>{line.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-muted">No match or pit notes on this team yet. Log them in Scouting.</p>
        )}
      </Panel>

      <Panel>
        <h3 style={{ marginTop: 0 }}>Public notes</h3>
        <p className="app-muted">
          These are public write-ups, not match scores.
          {findingCount > 0 ? ` ${findingCount} note${findingCount === 1 ? "" : "s"} on file.` : ""}
        </p>
        {intel.findings.length ? (
          <ul className="intel-findings">
            {intel.findings.map((finding) => (
              <li key={finding.id}>
                <div>
                  <span className="app-badge">{intelSourceTypeLabel(finding.sourceType)}</span>
                  <strong>{Math.round(finding.confidence * 100)}% sure</strong>
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
          <p className="app-muted">
            No public notes yet. Use Find public notes above when you want sourced write-ups.
          </p>
        )}
      </Panel>

      <Panel style={{ minHeight: "auto" }}>
        <button type="button" className="text-button" onClick={onToggleTools}>
          {toolsOpen ? "Hide compare and pick tools" : "Compare alliance / save pick"}
        </button>
        {toolsOpen ? (
          <div className="intel-tools">
            <form onSubmit={onCompare}>
              <FormRow label="Compare with 1–2 more teams" hint="Includes the looked-up team automatically.">
                <div className="intel-lookup-row">
                  <input
                    value={compare}
                    onChange={(e) => onCompareChange(e.target.value)}
                    placeholder="e.g. 1678, 118"
                    aria-label="Team numbers to compare"
                  />
                  <Button variant="secondary" type="submit" disabled={submitting}>
                    Compare
                  </Button>
                </div>
              </FormRow>
            </form>

            {comparison ? (
              <div className="intel-compare-result">
                <p>
                  <strong>Teams:</strong> {comparison.teams.map((t) => t.teamNumber).join(" · ")}
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
                    Chemistry <strong>{comparison.chemistry.score ?? "—"}</strong>
                    {comparison.chemistry.caveat || comparison.chemistry.caveats?.[0] ? (
                      <span className="app-muted">
                        {" "}
                        — {comparison.chemistry.caveat || comparison.chemistry.caveats?.[0]}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <a className="text-button" href={chemistryHref}>
                  Open Alliance Chemistry →
                </a>
              </div>
            ) : null}

            <div className="intel-pick-row">
              <FormRow
                label="Event"
                hint={
                  eventLabel
                    ? `Saves to ${eventLabel}.`
                    : "Set your active event before saving a pick."
                }
              >
                <input value={eventLabel ?? ""} readOnly aria-label="Event for this pick" />
              </FormRow>
              <FormRow label="Pick list name">
                <input
                  value={pickName}
                  onChange={(e) => onPickNameChange(e.target.value)}
                  aria-label="Pick list name"
                />
              </FormRow>
              <Button variant="secondary" type="button" onClick={onSavePick} disabled={submitting}>
                Save as #1 pick
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <IntelNextActionsPanel actions={readyActions} />
    </div>
  );
}
