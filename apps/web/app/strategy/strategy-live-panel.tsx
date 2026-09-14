"use client";

import { useMemo, useState } from "react";
import { runWhatIf } from "@vantage/prediction-strategy";
import { EmptyState, Panel, Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import { strategyCoverageLinks } from "../../lib/strategy/competition-related";
import {
  STRATEGY_RELATED_INCLUDE,
  strategyRelatedLinks,
} from "../../lib/strategy/strategy-related";
import { predictionWinDisplay } from "../../lib/strategy/prediction-display";
import { studentRatingLabel, studentSourceLabel } from "../../lib/ui/student-rating-label";
import type { StrategyView } from "../../lib/strategy/types";

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
      <span>{epa != null ? `Rating ${epa.toFixed(1)}` : "Rating —"}</span>
      <small>
        {record ?? "no record"}
        {source ? ` · ${studentSourceLabel(source)}` : ""}
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

function teamNum(teamKey: string) {
  return teamKey.replace(/^frc/i, "");
}

export function PrivateEdgePanel({ view }: { view: Extract<StrategyView, { status: "live" }> }) {
  const edge = view.privateEdge;
  if (!edge) {
    return (
      <Panel className="strategy-private-edge">
        <header>
          <div>
            <span className="eyebrow">Your team only</span>
            <h2>From our scouting</h2>
          </div>
          <span className="app-badge setup">from your notes</span>
        </header>
        <p className="app-muted">
          Your scouting notes, opponent profiles, and pit pings live here. Open this match after
          you have scouted it; public scores alone do not fill the why-we-win line.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="strategy-private-edge">
      <header>
        <div>
          <span className="eyebrow">Your team only</span>
          <h2>From our scouting</h2>
        </div>
        <span className={`app-badge ${edge.status === "live" ? "good" : "setup"}`}>
          {edge.status === "live" ? "From your notes" : "Needs scouting"}
        </span>
      </header>
      <p className="app-muted">{edge.message}</p>
      {edge.pepa.length ? (
        <ul className="strategy-pepa-table">
          {edge.pepa.map((row) => (
            <li key={row.teamKey}>
              <strong>{teamNum(row.teamKey)}</strong>
              <span>
                Our scouting {row.pepa.toFixed(1)}{" "}
                <small>
                  public {row.publicEpa.toFixed(1)} · scouted {row.scoutSample} matches
                </small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {edge.calibrations.length ? (
        <p className="app-muted">
          Scout calibration vs results:{" "}
          {edge.calibrations.slice(0, 4).map((row) => (
            <span key={`${row.scoutUserId}-${row.fieldKey}`} className="app-badge setup">
              {row.fieldKey} {Math.round(row.agreementRate * 100)}% (n={row.nSamples})
            </span>
          ))}
        </p>
      ) : null}
      {edge.differentials.length ? (
        <>
          <h3>Why we win / lose</h3>
          <ul className="factor-table">
            {edge.differentials.map((row) => (
              <li key={`${row.field}-${row.headline}`}>
                <b>{row.field.replace("_", " ")}</b>
                <span>{row.headline}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {edge.opponentProfiles.map((profile) => (
        <p key={profile.teamKey} className="app-muted">
          {profile.headlines.join(" · ")}
        </p>
      ))}
      {edge.counterPick && !edge.counterPick.skipped ? (
        <p>
          <strong>Counter-pick:</strong> {edge.counterPick.reason}
          {edge.counterPick.winRate != null
            ? ` (${Math.round(edge.counterPick.winRate * 100)}% of ${edge.counterPick.trials} trials)`
            : ""}
        </p>
      ) : null}
      {!edge.digitalTwin.skipped ? <p>{edge.digitalTwin.headline}</p> : null}
      {edge.pitAlerts.map((line) => (
        <p key={line}>
          <span className="app-badge danger">PIT</span> {line}
        </p>
      ))}
      {edge.cadLinks.length ? (
        <ul>
          {edge.cadLinks.slice(0, 4).map((link) => (
            <li key={`${link.subsystemId}-${link.fieldKey}`}>{link.headline}</li>
          ))}
        </ul>
      ) : null}
      {edge.knowledge.map((note) => (
        <p key={`${note.kind}-${note.title}`} className="app-muted">
          <strong>{note.kind}:</strong> {note.title} — {note.detail}
        </p>
      ))}
      {edge.evidence.length ? (
        <details>
          <summary>Scout evidence cards</summary>
          <ul>
            {edge.evidence.slice(0, 8).map((card) => (
              <li key={card.entryId}>
                {teamNum(card.teamKey)}
                {card.matchKey ? ` · ${card.matchKey}` : ""} — {card.note ?? "photo/voice attached"}
                {card.mediaCount ? ` · ${card.mediaCount} media` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

export function LivePanel({ view }: { view: Extract<StrategyView, { status: "live" }> }) {
  const [whatIfOn, setWhatIfOn] = useState(false);
  const [showDeep, setShowDeep] = useState(false);
  const scenario = useMemo(() => {
    if (!whatIfOn) return null;
    return runWhatIf(view.prediction, [
      { alliance: "red", label: "Protect autonomous route", pointDelta: 4 },
      { alliance: "blue", label: "One practiced defender", pointDelta: -3 },
    ]);
  }, [view.prediction, whatIfOn]);

  const sourceLabel =
    Array.from(new Set(view.sources.map((item) => studentSourceLabel(item.source)).filter(Boolean))).join(
      " · ",
    ) || "no linked source";
  const title =
    view.compLevel === "qm"
      ? `Qualification ${view.matchNumber}`
      : `${view.compLevel.toUpperCase()} ${view.matchNumber}`;
  const ourWin = view.ourAlliance === "red" ? view.prediction.pRed : view.prediction.pBlue;
  const ourWinDisplay = predictionWinDisplay({
    winProbability: ourWin,
    modelVersion: view.prediction.modelVersion,
    caveats: view.prediction.caveats,
  });
  const redWinDisplay = predictionWinDisplay({
    pRed: view.prediction.pRed,
    alliance: "red",
    modelVersion: view.prediction.modelVersion,
    caveats: view.prediction.caveats,
  });
  const cadHref = withOrgHref(
    `/cad?matchKey=${encodeURIComponent(view.matchKey)}&title=${encodeURIComponent(`${title} strategy mechanism`)}&request=${encodeURIComponent(`Engineer for ${title}. Priorities: ${view.playbook.priorities.slice(0, 3).join("; ")}`)}`,
    view.orgId,
  );
  const relatedLinks = strategyRelatedLinks(view.orgId, {
    include: [...STRATEGY_RELATED_INCLUDE],
  });
  const coverageLinks = strategyCoverageLinks(view.orgId, { eventKey: view.eventKey });

  return (
    <section className="strategy-workbench strategy-live-grid">
      <nav className="strategy-coverage-links product-hub-related" aria-label="Pick desk, Scouting, Event day">
        {relatedLinks.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>
      <nav className="strategy-coverage-links product-hub-related" aria-label="Explainability and coverage">
        {coverageLinks.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>
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
          Sources: {sourceLabel} · you are{" "}
          {view.ourAlliance.toUpperCase()} ({ourWinDisplay?.label ?? "—"} win)
          {view.eventName ? ` · ${view.eventName}` : ""}
        </p>
        <div className="strategy-probability">
          <strong>{redWinDisplay?.label ?? "—"}</strong>
          <span>Red alliance</span>
          {redWinDisplay ? (
            <small>
              {Math.round(view.prediction.confidenceLow * 100)}–{Math.round(view.prediction.confidenceHigh * 100)}%
              confidence · sample {view.prediction.effectiveSampleSize}
            </small>
          ) : (
            <small>No grounded prediction — recompute after match results are connected.</small>
          )}
        </div>
        {redWinDisplay ? (
          <div className="mini-probability">
            <i style={{ width: `${redWinDisplay.percent}%` }} />
          </div>
        ) : null}
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
                <em className={`strategy-kind ${factor.kind}`}>{factor.kind.toUpperCase()}</em>{" "}
                {studentRatingLabel(factor.name)}
              </span>
              <small>{studentRatingLabel(factor.evidence)}</small>
            </li>
          ))}
        </ul>
        {view.prediction.caveats.map((item) => (
          <p className="app-muted" key={item}>
            {studentRatingLabel(item)}
          </p>
        ))}
        {view.prediction.reasoningSteps?.length ? (
          <div className="strategy-reasoning">
            <h3>Reasoning depth</h3>
            <ol>
              {view.prediction.reasoningSteps.map((step) => (
                <li key={step.step}>
                  <strong>{studentRatingLabel(step.title)}</strong>
                  <small>{studentRatingLabel(step.detail)}</small>
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
              What each robot adds to the alliance — not match scores.
            </p>
            <div className="strategy-contrib-grid">
              <ContributionColumn title="Red" rows={view.allianceBreakdown.red} />
              <ContributionColumn title="Blue" rows={view.allianceBreakdown.blue} />
            </div>
            <h3>Cited match results</h3>
            {view.allianceBreakdown.citations.length === 0 ? (
              <p className="app-muted">No completed match results for these alliances yet.</p>
            ) : (
              <ul className="strategy-citations">
                {view.allianceBreakdown.citations.map((citation) => (
                  <li key={citation.matchKey}>
                    <span className="app-badge good">Event</span>
                    <span>{studentRatingLabel(citation.summary.replace(/^FACT\s*/, ""))}</span>
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
            <li key={item}>{studentRatingLabel(item)}</li>
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
                <small>{item.evidence.map(studentRatingLabel).join(" ")}</small>
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
            <a href={withOrgHref("/intel", view.orgId)}>Research</a>.
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
                      {ref.influence === "tba_conflict_excluded" ? " (results contradicted — excluded)" : ""}
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

      <PrivateEdgePanel view={view} />

      <Panel className="strategy-engineering-card">
        <header>
          <div>
            <span className="eyebrow">CAD for this match</span>
            <h2>Engineering reality</h2>
          </div>
          <Button as="a" variant="secondary" href={cadHref}>Send match to CAD</Button>
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
                <a href={withOrgHref(`/cad?jobId=${encodeURIComponent(item.jobId)}`, view.orgId)}>
                  Open engineering job
                </a>
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
          <Button as="a" variant="secondary" href={view.gameRules.kickoffHref}>
            Open kickoff
          </Button>
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
            badge={view.gameRules.status === "setup_required" ? "Needs setup" : "Empty"}
            badgeTone={view.gameRules.status === "setup_required" ? "setup" : ""}
            title={`No ${view.gameRules.seasonYear} game rules yet`}
            description={view.gameRules.message}
          >
            <Button as="a" variant="primary" href={view.gameRules.kickoffHref}>
              Capture {view.gameRules.seasonYear} rules on Kickoff
            </Button>
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
            <Button variant="secondary" type="button" onClick={() => setWhatIfOn(true)}>
              Run assumption scenario
            </Button>
          </div>
        ) : scenario ? (
          <>
            <div>
              <strong>
                {predictionWinDisplay({
                  pRed: scenario.pRed,
                  alliance: "red",
                  modelVersion: view.prediction.modelVersion,
                  caveats: view.prediction.caveats,
                })?.label ?? "—"}
              </strong>
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
