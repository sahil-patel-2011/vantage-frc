"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { runWhatIf } from "@vantage/prediction-strategy";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { EmptyState, PageHeader, Panel, TabBar } from "../../components/ui";
import { strategyFixture } from "../../lib/marketing/strategy-demo";
import type { StrategyView } from "../../lib/strategy/types";
import { PickListWorkbench } from "./pick-list-workbench";

function DemoPanel({ onHide }: { onHide: () => void }) {
  const { prediction, scenario, playbook } = strategyFixture;
  return (
    <section className="strategy-workbench" aria-label="Illustrative demo scenario">
      <div className="strategy-demo-banner">
        <span className="app-badge demo">Illustrative only · not live data</span>
        <p>
          This is an explicit opt-in demo. Numbers here are non-factual fixtures for exploring the model UI — not TBA,
          Statbotics, or your team’s event.
        </p>
        <button type="button" className="app-button secondary" onClick={onHide}>
          Exit demo
        </button>
      </div>
      <article className="app-card strategy-primary">
        <header>
          <div>
            <span className="app-badge demo">Demo</span>
            <h2>Qualification 42</h2>
          </div>
          <small>{prediction.modelVersion}</small>
        </header>
        <p className="app-muted strategy-provenance">
          <span className="app-badge demo">DEMO</span> Engine {prediction.modelVersion} · illustrative fixture only
        </p>
        <div className="strategy-probability">
          <strong>{Math.round(prediction.pRed * 100)}%</strong>
          <span>Red alliance</span>
          <small>
            {Math.round(prediction.confidenceLow * 100)}–{Math.round(prediction.confidenceHigh * 100)}% confidence ·
            effective sample {prediction.effectiveSampleSize}
          </small>
        </div>
        <div className="mini-probability">
          <i style={{ width: `${prediction.pRed * 100}%` }} />
        </div>
        <h3>Key factors</h3>
        <ul className="factor-table">
          {prediction.keyFactors.map((factor) => (
            <li key={factor.name}>
              <b>{factor.impact}</b>
              <span>{factor.name}</span>
              <small>{factor.evidence}</small>
            </li>
          ))}
        </ul>
        {prediction.caveats.map((item) => (
          <p className="app-muted" key={item}>
            {item}
          </p>
        ))}
      </article>
      <article className="app-card what-if-card">
        <header>
          <h2>What-if scenario</h2>
          <span className="app-badge demo">Demo</span>
        </header>
        <div>
          <strong>{Math.round(scenario.pRed * 100)}%</strong>
          <span>
            {scenario.delta >= 0 ? "+" : ""}
            {Math.round(scenario.delta * 100)} pts
          </span>
        </div>
        <ul>
          {scenario.assumptions.map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <b>
                {item.pointDelta > 0 ? "+" : ""}
                {item.pointDelta} points
              </b>
            </li>
          ))}
        </ul>
        <p className="app-muted">Assumptions only — not observations.</p>
      </article>
      <article className="app-card playbook-card">
        <header>
          <h2>Alliance playbook</h2>
          <span className="app-badge demo">Demo</span>
        </header>
        <ol>
          {playbook.priorities.map((item, index) => (
            <li key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <h3>Role checkpoints</h3>
        <div className="checkpoint-row">
          {playbook.checkpoints.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </article>
    </section>
  );
}

function TeamChip({
  teamKey,
  epa,
  record,
  source,
  scoutSample,
  reliability,
  autoCapability,
  teleopCapability,
  qualityWeight,
}: {
  teamKey: string;
  epa: number | null;
  record: string | null;
  source: string | null;
  scoutSample?: number;
  reliability?: number | null;
  autoCapability?: number | null;
  teleopCapability?: number | null;
  qualityWeight?: number | null;
}) {
  const scoutBits = [
    scoutSample && scoutSample > 0 ? `scout n=${scoutSample}` : null,
    reliability != null ? `rel ${Math.round(reliability)}%` : null,
    autoCapability != null && autoCapability >= 0.35
      ? `auto ${Math.round(autoCapability * 100)}%`
      : null,
    teleopCapability != null && teleopCapability >= 0.35
      ? `tele ${Math.round(teleopCapability * 100)}%`
      : null,
    qualityWeight != null && qualityWeight < 0.95
      ? `q ${Math.round(qualityWeight * 100)}%`
      : null,
  ].filter(Boolean);
  return (
    <li>
      <strong>{teamKey.replace(/^frc/, "")}</strong>
      <span>{epa != null ? `EPA ${epa.toFixed(1)}` : "EPA —"}</span>
      <small>
        {record ?? "no record"}
        {source ? ` · ${source}` : ""}
        {scoutBits.length ? ` · ${scoutBits.join(" · ")}` : ""}
      </small>
    </li>
  );
}

function ContributionColumn({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    teamKey: string;
    shareOfAlliance: number;
    deltaPRed: number;
    contributionPts: number;
  }>;
}) {
  const sorted = [...rows].sort((a, b) => b.contributionPts - a.contributionPts);
  return (
    <div className="strategy-contrib-col">
      <h4>{title}</h4>
      <ul>
        {sorted.map((row) => (
          <li key={row.teamKey}>
            <div className="strategy-contrib-head">
              <strong>{row.teamKey.replace(/^frc/, "")}</strong>
              <span>{Math.round(row.shareOfAlliance * 100)}% rating</span>
            </div>
            <div className="strategy-contrib-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(4, row.shareOfAlliance * 100)}%` }} />
            </div>
            <small>
              Δp(red) {row.deltaPRed >= 0 ? "+" : ""}
              {(row.deltaPRed * 100).toFixed(1)} pts · {row.contributionPts.toFixed(1)} rating
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LivePanel({ view }: { view: Extract<StrategyView, { status: "live" }> }) {
  const [whatIfOn, setWhatIfOn] = useState(false);
  const [showDeep, setShowDeep] = useState(false);
  const scenario = useMemo(() => {
    if (!whatIfOn) return null;
    return runWhatIf(view.prediction, [
      { alliance: "red", label: "Protect autonomous route", pointDelta: 4 },
      { alliance: "blue", label: "One practiced defender", pointDelta: -3 },
    ]);
  }, [view.prediction, whatIfOn]);

  const sourceLabel = Array.from(new Set(view.sources.map((item) => item.source))).join(" · ") || "no linked source";
  const title =
    view.compLevel === "qm"
      ? `Qualification ${view.matchNumber}`
      : `${view.compLevel.toUpperCase()} ${view.matchNumber}`;
  const ourWin = view.ourAlliance === "red" ? view.prediction.pRed : view.prediction.pBlue;
  const cadHref = `/cad?orgId=${encodeURIComponent(view.orgId)}&matchKey=${encodeURIComponent(view.matchKey)}&title=${encodeURIComponent(`${title} strategy mechanism`)}&request=${encodeURIComponent(`Engineer for ${title}. Priorities: ${view.playbook.priorities.slice(0, 3).join("; ")}`)}`;

  return (
    <section className="strategy-workbench strategy-live-grid">
      <Panel className="strategy-primary">
        <header>
          <div>
            <span className="app-badge good">Live inputs</span>
            <h2>{title}</h2>
          </div>
          <small title={`Plan ${view.engine.planCode} · depth ${view.engine.depth}`}>
            {view.engine.label}
          </small>
        </header>
        <p className="app-muted strategy-provenance">
          <span className="app-badge good">Engine</span> {view.engine.id} · plan{" "}
          {view.engine.planCode.replace(/_/g, " ")}
          {view.engine.thisSeasonOnly ? " · this-season rules" : " · multi-season weights"}
          {view.productVersion ? ` · product ${view.productVersion}` : ""}
        </p>
        <p className="app-muted strategy-provenance">
          <span className="app-badge setup">MODEL</span> Sources: {sourceLabel} · you are{" "}
          {view.ourAlliance.toUpperCase()} ({Math.round(ourWin * 100)}% win)
          {view.eventName ? ` · ${view.eventName}` : ""}
        </p>
        <div className="strategy-probability">
          <strong>{Math.round(view.prediction.pRed * 100)}%</strong>
          <span>Red alliance</span>
          <small>
            {Math.round(view.prediction.confidenceLow * 100)}–{Math.round(view.prediction.confidenceHigh * 100)}%
            confidence · sample {view.prediction.effectiveSampleSize}
          </small>
        </div>
        <div className="mini-probability">
          <i style={{ width: `${view.prediction.pRed * 100}%` }} />
        </div>
        <div className="strategy-alliance-row">
          <div>
            <h3>Red</h3>
            <ul className="strategy-team-chips">
              {view.matchup.red.map((team) => (
                <TeamChip key={team.teamKey} {...team} />
              ))}
            </ul>
          </div>
          <div>
            <h3>Blue</h3>
            <ul className="strategy-team-chips">
              {view.matchup.blue.map((team) => (
                <TeamChip key={team.teamKey} {...team} />
              ))}
            </ul>
          </div>
        </div>
        <h3>Key factors</h3>
        <ul className="factor-table">
          {view.prediction.keyFactors.map((factor) => (
            <li key={`${factor.kind}-${factor.name}`}>
              <b>{factor.impact}</b>
              <span>
                <em className={`strategy-kind ${factor.kind}`}>{factor.kind.toUpperCase()}</em> {factor.name}
              </span>
              <small>{factor.evidence}</small>
            </li>
          ))}
        </ul>
        {view.prediction.caveats.map((item) => (
          <p className="app-muted" key={item}>
            {item}
          </p>
        ))}
        {view.prediction.reasoningSteps?.length ? (
          <div className="strategy-reasoning">
            <h3>Reasoning depth</h3>
            <ol>
              {view.prediction.reasoningSteps.map((step) => (
                <li key={step.step}>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        <button type="button" className="text-button" onClick={() => setShowDeep((open) => !open)}>
          {showDeep ? "Hide contribution & citations" : "Alliance contribution & citations"}
        </button>
        {showDeep ? (
          <div className="strategy-deep">
            <p className="app-muted strategy-contrib-note">
              <span className="app-badge setup">MODEL</span> Leave-one-out Δp(red) and rating share — not TBA facts.
            </p>
            <div className="strategy-contrib-grid">
              <ContributionColumn title="Red" rows={view.allianceBreakdown.red} />
              <ContributionColumn title="Blue" rows={view.allianceBreakdown.blue} />
            </div>
            <h3>Cited match results</h3>
            {view.allianceBreakdown.citations.length === 0 ? (
              <p className="app-muted">No completed TBA match results for these alliances yet.</p>
            ) : (
              <ul className="strategy-citations">
                {view.allianceBreakdown.citations.map((citation) => (
                  <li key={citation.matchKey}>
                    <span className="app-badge good">FACT</span>
                    <span>{citation.summary.replace(/^FACT\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel className="strategy-matchup-card">
        <header>
          <h2>Coach notes</h2>
          <span className="app-badge good">Metrics + scout</span>
        </header>
        <ul className="strategy-considerations">
          {view.matchup.considerations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3>Opponent tendencies</h3>
        {view.tendencies.length === 0 ? (
          <p className="app-muted">No opponent history available yet.</p>
        ) : (
          <ul className="strategy-tendencies">
            {view.tendencies.map((item) => (
              <li key={item.teamKey}>
                <strong>{item.teamKey.replace(/^frc/, "")}</strong>
                {item.labels.length ? (
                  <span className="strategy-labels">
                    {item.labels.map((label) => (
                      <em key={label}>{label}</em>
                    ))}
                  </span>
                ) : null}
                <small>{item.evidence.join(" ")}</small>
              </li>
            ))}
          </ul>
        )}
        {view.pickListHints.length > 0 ? (
          <>
            <h3>Pick-list inputs</h3>
            <ul className="strategy-pick-hints">
              {view.pickListHints.map((hint) => (
                <li key={`${hint.listName}-${hint.teamKey}-${hint.rank}`}>
                  <b>#{hint.rank}</b>
                  <span>
                    {hint.teamKey.replace(/^frc/, "")} · {hint.listName}
                    {hint.tier ? ` · ${hint.tier}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="app-muted">
            No pick ranks yet. Use the Pick lists tab or{" "}
            <a href={`/intel?orgId=${encodeURIComponent(view.orgId)}`}>Intel</a>.
          </p>
        )}
        {view.scoutProvenance.length > 0 || view.operations.some((op) => (op.pitNotes?.length ?? 0) > 0) ? (
          <details className="strategy-provenance-details">
            <summary>Scout provenance & pit notes</summary>
            {view.scoutProvenance.length === 0 ? (
              <p className="app-muted">No org scout entries influenced this prediction yet.</p>
            ) : (
              <ul className="strategy-scout-provenance">
                {view.scoutProvenance.slice(0, 12).map((ref) => (
                  <li key={`${ref.entryId}-${ref.influence}`}>
                    <strong>{ref.teamKey.replace(/^frc/, "")}</strong>
                    {ref.source === "video" || ref.influence === "video_rescore" ? (
                      <span className="app-badge setup">VIDEO</span>
                    ) : null}
                    <span>
                      {ref.entryType} · {ref.influence}
                      {ref.influence === "tba_conflict_excluded" ? " (TBA contradicted — excluded)" : ""}
                      {ref.videoAtSeconds != null ? ` @${ref.videoAtSeconds}s` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.operations
              .filter((op) => (op.pitNotes?.length ?? 0) > 0)
              .map((op) => (
                <p key={op.teamKey} className="app-muted">
                  <strong>{op.teamKey.replace(/^frc/, "")}</strong>: {op.pitNotes!.slice(0, 2).join(" · ")}
                </p>
              ))}
          </details>
        ) : null}
      </Panel>

      <Panel className="playbook-card">
        <header>
          <h2>Alliance playbook</h2>
          <span className="app-badge good">From live prediction</span>
        </header>
        <ol>
          {view.playbook.priorities.map((item, index) => (
            <li key={item}>
              <b>{index + 1}</b>
              <span>{item}</span>
            </li>
          ))}
        </ol>
        <h3>Role checkpoints</h3>
        <div className="checkpoint-row">
          {view.playbook.checkpoints.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </Panel>

      <Panel className="strategy-engineering-card">
        <header>
          <div>
            <span className="eyebrow">STRATEGY ↔ CAD</span>
            <h2>Engineering reality</h2>
          </div>
          <a className="app-button secondary" href={cadHref}>Send match to CAD</a>
        </header>
        {view.engineeringContext.length ? (
          <ul className="strategy-engineering-list">
            {view.engineeringContext.map((item) => (
              <li key={item.jobId}>
                <div>
                  <strong>{item.title}</strong>
                  <span className={`app-badge ${item.status === "completed" ? "good" : "setup"}`}>
                    {item.status.replaceAll("_", " ")}
                  </span>
                </div>
                <p>{item.requirements.slice(0, 2).join(" · ") || "Brief requirements awaiting confirmation."}</p>
                {item.latestArtifact ? (
                  <small>Latest verified output: {item.latestArtifact.title} · v{item.latestArtifact.version}</small>
                ) : (
                  <small>No geometry artifact yet — strategy should treat this capability as unverified.</small>
                )}
                <a href={`/cad?orgId=${encodeURIComponent(view.orgId)}&jobId=${encodeURIComponent(item.jobId)}`}>Open engineering job</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-muted">
            No engineering job is linked to this match yet. Send the live priorities to CAD; confirmed requirements and artifacts will return here automatically.
          </p>
        )}
      </Panel>

      <Panel className="strategy-rules-card">
        <header>
          <div>
            <span className="eyebrow">THIS SEASON ONLY · {view.gameRules.seasonYear}</span>
            <h2>Game rules</h2>
          </div>
          <a className="app-button secondary" href={view.gameRules.kickoffHref}>
            Open kickoff
          </a>
        </header>
        {view.gameRules.status === "ready" ? (
          <>
            <p className="app-muted">{view.gameRules.message}</p>
            {view.gameRules.constraints.length ? (
              <ul>
                {view.gameRules.constraints.slice(0, 6).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {view.gameRules.designPriorities.length ? (
              <>
                <h3>Design priorities</h3>
                <ul>
                  {view.gameRules.designPriorities.slice(0, 6).map((item) => (
                    <li key={item.id}>
                      <strong>{item.capability}</strong>
                      {item.rationale ? <small> — {item.rationale}</small> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {view.gameRules.ruleNotes.filter((n) => n.status === "open").length ? (
              <>
                <h3>Open rule questions</h3>
                <ul>
                  {view.gameRules.ruleNotes
                    .filter((n) => n.status === "open")
                    .slice(0, 5)
                    .map((item) => (
                      <li key={item.id}>
                        {item.ruleRef ? <b>{item.ruleRef}</b> : null} {item.question}
                      </li>
                    ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <EmptyState
            badge={view.gameRules.status === "setup_required" ? "Setup required" : "Empty"}
            badgeTone={view.gameRules.status === "setup_required" ? "setup" : ""}
            title={`No ${view.gameRules.seasonYear} game rules yet`}
            description={view.gameRules.message}
          >
            <a className="app-button" href={view.gameRules.kickoffHref}>
              Capture {view.gameRules.seasonYear} rules on Kickoff
            </a>
          </EmptyState>
        )}
      </Panel>

      <Panel className="what-if-card">
        <header>
          <h2>What-if</h2>
          <span className="app-badge setup">Optional assumptions</span>
        </header>
        {!whatIfOn ? (
          <div className="strategy-empty-block">
            <p className="app-muted">Layer assumption deltas on the live prediction — not scouting observations.</p>
            <button type="button" className="app-button secondary" onClick={() => setWhatIfOn(true)}>
              Run assumption scenario
            </button>
          </div>
        ) : scenario ? (
          <>
            <div>
              <strong>{Math.round(scenario.pRed * 100)}%</strong>
              <span>
                {scenario.delta >= 0 ? "+" : ""}
                {Math.round(scenario.delta * 100)} pts
              </span>
            </div>
            <ul>
              {scenario.assumptions.map((item) => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <b>
                    {item.pointDelta > 0 ? "+" : ""}
                    {item.pointDelta} points
                  </b>
                </li>
              ))}
            </ul>
            <button type="button" className="text-button" onClick={() => setWhatIfOn(false)}>
              Clear assumptions
            </button>
          </>
        ) : null}
      </Panel>
    </section>
  );
}

function TbaKeyHint({ view }: { view: StrategyView }) {
  const access = view.tbaAccess;
  const stat = view.referenceAccess?.statbotics;
  if (access?.tbaConfigured && (stat?.cacheHasMetrics ?? true)) return null;
  return (
    <div className="strategy-reference-hints">
      {access && !access.tbaConfigured ? (
        <p className="telemetry-status" role="status">
          TBA key missing: set platform <code>TBA_AUTH_KEY</code> or save an org/platform credential under Team → Data.
          Strategy will stay empty until the Neon TBA cache is synced.
        </p>
      ) : null}
      {stat && !stat.cacheHasMetrics ? (
        <p className="telemetry-status" role="status">
          Statbotics EPA cache is empty ({stat.eventMetricRows} event / {stat.yearMetricRows} year rows). Sync
          reference data under Team → Data — Statbotics is public (no key); Vantage will not invent EPA while the
          cache is empty.
        </p>
      ) : null}
    </div>
  );
}

type StrategyTab = "matchup" | "picks";

export default function StrategyClient() {
  const [view, setView] = useState<StrategyView | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [tab, setTab] = useState<StrategyTab>("matchup");

  const loadStrategy = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const requestedTab = params.get("tab");
    if (requestedTab === "picks") setTab("picks");
    void fetch(`/api/strategy${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as StrategyView | { error?: string };
        if (!response.ok || !("status" in data)) {
          const message = "error" in data ? data.error : undefined;
          if (!message) {
            setFetchFailed(true);
            return;
          }
          setError(message);
          setView({
            status: "setup_required",
            message: "Select a team workspace before running win/loss strategy.",
            steps: [
              {
                id: "workspace",
                label: "Select workspace and event",
                detail: "Choose your team organization and active event",
                href: "/workspace",
              },
              {
                id: "tba",
                label: "Sync TBA",
                detail: "Match schedule and team metrics from TBA/Statbotics",
                href: "/team/data",
              },
            ],
            orgId: null,
            eventKey: null,
            eventName: null,
            teamNumber: null,
            tbaConfigured: false,
          });
          return;
        }
        setView(data);
      })
      .catch(() => {
        setFetchFailed(true);
      });
  }, []);

  useEffect(() => {
    loadStrategy();
  }, [loadStrategy]);

  const orgId = view && "orgId" in view ? view.orgId : null;

  return (
    <main className="module-page strategy-page">
      <PageHeader
        breadcrumbs="Competition / Strategy"
        title="Strategy & AI"
        description="Win/loss and pick desks run only on synced TBA/Statbotics metrics and your scout notes — never invented."
      >
        <div className="strategy-header-actions">
          {orgId ? (
            <>
              <a
                className="app-button secondary"
                href={`/competition?tab=scouting&orgId=${encodeURIComponent(orgId)}`}
              >
                Scouting
              </a>
              <a
                className="app-button secondary"
                href={`/competition?tab=forms&orgId=${encodeURIComponent(orgId)}`}
              >
                Form builder
              </a>
              <a
                className="app-button secondary"
                href={`/competition?tab=match-checklist&orgId=${encodeURIComponent(orgId)}`}
              >
                Match checklist
              </a>
              <a className="app-button secondary" href={`/pick-clock?orgId=${encodeURIComponent(orgId)}`}>
                Pick clock (45s)
              </a>
              <a className="app-button secondary" href={`/strategy/draft?orgId=${encodeURIComponent(orgId)}`}>
                Draft day board
              </a>
              <a
                className="app-button secondary"
                href={`/exports?orgId=${encodeURIComponent(orgId)}&domains=pick-lists,reference-metrics,research`}
              >
                Export strategy data
              </a>
              <a className="app-button secondary" href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>
                Data provenance
              </a>
            </>
          ) : null}
          {demo ? (
            <span className="app-badge demo">Demo mode</span>
          ) : view?.status === "empty" ? (
            <span className="app-badge setup">No prediction yet</span>
          ) : view?.status === "setup_required" ? (
            <span className="app-badge setup">Setup required</span>
          ) : view?.status === "live" ? (
            <span className={`app-badge ${view.dataSourceHealth?.degraded ? "setup" : "good"}`}>
              {view.dataSourceHealth?.usingLastGoodCache ? "Last-good cache" : "Live inputs"}
            </span>
          ) : null}
        </div>
      </PageHeader>

      <TabBar
        aria-label="Strategy sections"
        value={tab}
        onChange={(id) => setTab(id as StrategyTab)}
        tabs={[
          { id: "matchup", label: "Matchup" },
          { id: "picks", label: "Pick lists" },
        ]}
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <DataSourceDegradedBanner health={view?.dataSourceHealth} />

      {view ? <TbaKeyHint view={view} /> : null}

      {tab === "picks" ? (
        <PickListWorkbench orgId={orgId} embedded />
      ) : demo ? (
        <DemoPanel onHide={() => setDemo(false)} />
      ) : fetchFailed ? (
        <EmptyState
          title="Could not load strategy"
          description="A network or server issue prevented loading your strategy context."
        >
          <button type="button" className="app-button secondary" onClick={loadStrategy}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking workspace, event, and TBA/reference metrics." aria-busy />
      ) : view.status === "live" ? (
        <LivePanel view={view} />
      ) : (
        <section className="strategy-setup" aria-label="Strategy setup">
          <EmptyState
            badge={view.status === "empty" ? "No prediction yet" : "Setup required"}
            badgeTone="setup"
            title={view.message}
            description="No fabricated win probability until TBA/Statbotics (and optional scouting) inputs exist for a real match. Pick lists still work once an event is selected."
          >
            {view.engine ? (
              <p className="app-muted strategy-engine-soft">
                Active engine for your plan ({view.engine.planCode.replace(/_/g, " ")}):{" "}
                <strong>{view.engine.label}</strong>
                {view.productVersion ? ` · product ${view.productVersion}` : ""}
              </p>
            ) : null}
            <ol className="strategy-setup-steps">
              {view.steps.map((step) => (
                <li key={step.id} className={step.done ? "done" : undefined}>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  {step.done ? <em>Done</em> : <a href={step.href}>Open</a>}
                </li>
              ))}
            </ol>
          </EmptyState>
          <Panel className="strategy-demo-optin" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Try demo scenario</h2>
            <p className="app-muted">
              Optional illustrative fixture only. Labeled non-factual — never your default Strategy view.
            </p>
            <button type="button" className="app-button secondary" onClick={() => setDemo(true)}>
              Try demo scenario
            </button>
          </Panel>
        </section>
      )}
    </main>
  );
}
