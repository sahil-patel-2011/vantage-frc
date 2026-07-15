"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { runWhatIf } from "@vantage/prediction-strategy";
import { strategyFixture } from "../../lib/marketing/strategy-demo";
import type { StrategyView } from "../../lib/strategy/types";

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

function LivePanel({ view }: { view: Extract<StrategyView, { status: "live" }> }) {
  const [whatIfOn, setWhatIfOn] = useState(false);
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

  return (
    <section className="strategy-workbench">
      <article className="app-card strategy-primary">
        <header>
          <div>
            <span className="app-badge good">Live inputs</span>
            <h2>{title}</h2>
          </div>
          <small>{view.prediction.modelVersion}</small>
        </header>
        <p className="app-muted strategy-provenance">
          Sources: {sourceLabel} · computed {new Date(view.computedAt).toLocaleString()} · match {view.matchKey}
          {view.eventName ? ` · ${view.eventName}` : ""}
        </p>
        <div className="strategy-probability">
          <strong>{Math.round(view.prediction.pRed * 100)}%</strong>
          <span>Red alliance</span>
          <small>
            {Math.round(view.prediction.confidenceLow * 100)}–{Math.round(view.prediction.confidenceHigh * 100)}%
            confidence · effective sample {view.prediction.effectiveSampleSize}
          </small>
        </div>
        <div className="mini-probability">
          <i style={{ width: `${view.prediction.pRed * 100}%` }} />
        </div>
        <h3>Key factors</h3>
        <ul className="factor-table">
          {view.prediction.keyFactors.map((factor) => (
            <li key={factor.name}>
              <b>{factor.impact}</b>
              <span>{factor.name}</span>
              <small>{factor.evidence}</small>
            </li>
          ))}
        </ul>
        {view.prediction.caveats.map((item) => (
          <p className="app-muted" key={item}>
            {item}
          </p>
        ))}
      </article>
      <article className="app-card what-if-card">
        <header>
          <h2>What-if scenario</h2>
          <span className="app-badge setup">Assumptions</span>
        </header>
        {!whatIfOn ? (
          <div className="strategy-empty-block">
            <p>Optional. What-if deltas are assumptions layered on the live prediction — not scouting observations.</p>
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
      </article>
      <article className="app-card playbook-card">
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
      </article>
    </section>
  );
}

export default function StrategyClient() {
  const [view, setView] = useState<StrategyView | null>(null);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);

  const loadStrategy = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const orgId = new URLSearchParams(window.location.search).get("orgId");
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
              { id: "workspace", label: "Select workspace and event", detail: "Choose your team organization and active event", href: "/workspace" },
              { id: "tba", label: "Sync TBA", detail: "Match schedule and team metrics from TBA/Statbotics", href: "/team/data" },
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

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Competition / Strategy</span>
          <h1>Win / Loss + Strategy</h1>
          <p>
            Predictions run only when match schedule and team metrics exist. Vantage does not invent win probability,
            EPA, ranks, or confidence.
          </p>
        </div>
        {demo ? (
          <span className="app-badge demo">Demo mode</span>
        ) : view?.status === "empty" ? (
          <span className="app-badge setup">No prediction yet</span>
        ) : view?.status === "setup_required" ? (
          <span className="app-badge setup">Setup required</span>
        ) : view?.status === "live" ? (
          <span className="app-badge good">Live inputs</span>
        ) : null}
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {demo ? (
        <DemoPanel onHide={() => setDemo(false)} />
      ) : fetchFailed ? (
        <section className="app-card strategy-empty-panel">
          <h2>Could not load strategy — try again</h2>
          <p className="app-muted">A network or server issue prevented loading your strategy context.</p>
          <button type="button" className="app-button secondary" onClick={loadStrategy}>
            Retry
          </button>
        </section>
      ) : view == null ? (
        <section className="app-card strategy-empty-panel">
          <h2>Loading strategy context…</h2>
          <p className="app-muted">Checking workspace, event, and TBA/reference metrics.</p>
        </section>
      ) : view.status === "live" ? (
        <LivePanel view={view} />
      ) : (
        <section className="strategy-setup" aria-label="Strategy setup">
          <article className="app-card strategy-empty-panel">
            <span className="app-badge setup">{view.status === "empty" ? "No prediction yet" : "Setup required"}</span>
            <h2>{view.message}</h2>
            <p className="app-muted">
              No fabricated win probability is shown until TBA/Statbotics (and optional scouting) inputs are available for
              a real match.
            </p>
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
          </article>
          <aside className="app-card strategy-demo-optin">
            <h2>Try demo scenario</h2>
            <p>
              Optional illustrative fixture only. Labeled non-factual — never used as your default Stats/Strategy view.
            </p>
            <button type="button" className="app-button secondary" onClick={() => setDemo(true)}>
              Try demo scenario
            </button>
          </aside>
        </section>
      )}
    </main>
  );
}
