import {
  cadFixture,
  codeFixture,
  codeLesson,
  codeSample,
  strategyFixture,
} from "../../lib/marketing/demo-fixtures";

function DemoChrome({
  title,
  meta,
}: {
  title: string;
  meta: string;
}) {
  return (
    <header className="product-demo-chrome">
      <span className="app-badge demo">Demo data</span>
      <strong>{title}</strong>
      <b>{meta}</b>
    </header>
  );
}

export function StrategyPreview({ compact = false }: { compact?: boolean }) {
  const { prediction, scenario, playbook, ourAlliance } = strategyFixture;
  const pct = Math.round(prediction.pRed * 100);
  const low = Math.round(prediction.confidenceLow * 100);
  const high = Math.round(prediction.confidenceHigh * 100);
  const whatIf = Math.round(scenario.pRed * 100);
  const delta = Math.round(scenario.delta * 100);

  return (
    <div
      className={`product-demo strategy-product-demo ${compact ? "compact" : ""}`}
      aria-label="Demo data preview of the Win/Loss and Strategy Engine"
    >
      <DemoChrome title="Qualification 42 · Win / Loss + Strategy" meta={prediction.modelVersion} />
      <div className={`strategy-workbench marketing-demo-board ${compact ? "compact-board" : ""}`}>
        <article className="app-card strategy-primary">
          <header>
            <div>
              <span className="app-badge good">Available</span>
              <h2>Qualification 42</h2>
            </div>
            <small>{prediction.modelVersion}</small>
          </header>
          <div className="strategy-probability">
            <strong>{pct}%</strong>
            <span>{ourAlliance === "red" ? "Red" : "Blue"} alliance</span>
            <small>
              {low}–{high}% confidence · effective sample {prediction.effectiveSampleSize}
            </small>
          </div>
          <div className="mini-probability" aria-label={`Demo win probability ${pct} percent`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <h3>Key factors</h3>
          <ul className="factor-table">
            {prediction.keyFactors.slice(0, compact ? 2 : 3).map((factor) => {
              const favorable = factor.alliance === ourAlliance;
              return (
                <li key={factor.name} className={favorable ? undefined : "risk"}>
                  <b>
                    {favorable ? "+" : "−"}
                    {factor.impact}
                  </b>
                  <span>{factor.name}</span>
                  {!compact && <small>{factor.evidence}</small>}
                </li>
              );
            })}
          </ul>
          {!compact &&
            prediction.caveats.map((item) => (
              <p className="app-muted" key={item}>
                {item}
              </p>
            ))}
        </article>
        {!compact && (
          <>
            <article className="app-card what-if-card">
              <header>
                <h2>What-if scenario</h2>
                <span className="app-badge demo">Demo data</span>
              </header>
              <div>
                <strong>{whatIf}%</strong>
                <span>
                  {delta >= 0 ? "+" : ""}
                  {delta} pts
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
              <p className="app-muted">Scenario changes are stored as assumptions, not observations.</p>
            </article>
            <article className="app-card playbook-card">
              <header>
                <h2>Alliance playbook</h2>
                <span className="app-badge demo">Demo data</span>
              </header>
              <ol>
                {playbook.priorities.slice(0, 3).map((item, index) => (
                  <li key={item}>
                    <b>{index + 1}</b>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </article>
          </>
        )}
      </div>
    </div>
  );
}

export function CadPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`product-demo cad-product-demo ${compact ? "compact" : ""}`}
      aria-label="Demo data preview of the AI CAD Builder"
    >
      <DemoChrome title="AI CAD Builder · Engineering thread" meta="Setup required" />
      <div className="cad-demo-shell">
        <section>
          <span className="app-badge setup">Setup required</span>
          <small>CONFIRMED BRIEF</small>
          <h3>{cadFixture.title}</h3>
          <p>{cadFixture.brief}</p>
          <div className="connector-row">
            {cadFixture.connectors.map((item) => (
              <span key={item.name}>
                {item.name}
                <i>{item.status}</i>
              </span>
            ))}
          </div>
        </section>
        <ol>
          {cadFixture.steps.map((step, index) => (
            <li key={step.id} className={index === 0 ? "done" : index === 1 ? "active" : undefined}>
              <b>{step.id}</b>
              <span>{step.label}</span>
              <small>{step.state}</small>
            </li>
          ))}
        </ol>
      </div>
      {!compact && (
        <footer className="product-demo-footer">
          <span>Human approval required before mutation</span>
          <b>Checkpoint 0 / 3</b>
        </footer>
      )}
    </div>
  );
}

export function CodePreview({ compact = false }: { compact?: boolean }) {
  const review = codeFixture;
  const primary = review.risks[0];

  return (
    <div
      className={`product-demo code-product-demo ${compact ? "compact" : ""}`}
      aria-label="Demo data preview of the FRC Code Builder / Debugger"
    >
      <DemoChrome title="FRC Code Builder / Debugger · DriveSubsystem.java" meta="Learn · propose" />
      <div className={`code-lesson-board marketing-demo-board ${compact ? "compact-board" : ""}`}>
        <article className="app-card code-source">
          <header>
            <div>
              <span className="app-badge">Repository input</span>
              <h2>DriveSubsystem.java</h2>
            </div>
            <span className="app-badge demo">Demo data</span>
          </header>
          <pre aria-label="Demo repository input">{codeSample}</pre>
        </article>

        <article className="app-card code-findings">
          <header>
            <div>
              <span className={`app-badge ${review.riskLevel === "high" ? "danger" : ""}`}>
                {review.riskLevel} risk
              </span>
              <h2>Review findings</h2>
            </div>
            <strong>{review.risks.length}</strong>
          </header>
          {primary && (
            <div className="code-finding-focus">
              <div>
                <span className={`severity ${primary.severity}`}>{primary.severity}</span>
                <b>{primary.pattern.replaceAll("-", " ")}</b>
              </div>
              <p>{primary.message}</p>
              <code>{primary.evidence}</code>
            </div>
          )}
          {!compact && (
            <p className="code-coach-note">
              Mentors and students see the risk with file evidence—then keep reading for why and a safer habit.
            </p>
          )}
        </article>

        {!compact && (
          <article className="app-card code-teach">
            <header>
              <h2>Learning coach</h2>
              <span className="app-badge good">Teach</span>
            </header>
            <dl className="code-teach-steps">
              <div>
                <dt>Flagged</dt>
                <dd>
                  <code>{codeLesson.flagged}</code>
                </dd>
              </div>
              <div>
                <dt>Why it matters</dt>
                <dd>{codeLesson.why}</dd>
              </div>
              <div>
                <dt>Better habit</dt>
                <dd>{codeLesson.betterApproach}</dd>
              </div>
            </dl>
            <pre className="code-better-sample" aria-label="Demo safer pattern">
              {codeLesson.betterSample}
            </pre>
            <div className="proposal-state">
              <span>OUTPUT STATE</span>
              <strong>Proposal only · human approval required</strong>
            </div>
          </article>
        )}
      </div>
      {!compact && (
        <ul className="code-capability-row" aria-label="Code Builder capabilities">
          {codeLesson.capabilities.map((item) => (
            <li key={item.id}>
              <b>{item.id}</b>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScoutPreview() {
  return (
    <div className="product-demo compact ops-demo" aria-label="Demo offline scouting sync preview">
      <DemoChrome title="Scouting · Qual 18 · Team 254" meta="Offline → sync" />
      <div className="ops-demo-body scout-ops">
        <div className="ops-demo-stat-row">
          <div>
            <span>Queue</span>
            <strong>3</strong>
            <small>pending sync</small>
          </div>
          <div>
            <span>Last save</span>
            <strong>Local</strong>
            <small>venue Wi-Fi down</small>
          </div>
          <div>
            <span>Attribution</span>
            <strong>Maya R.</strong>
            <small>match form</small>
          </div>
        </div>
        <ul>
          <li>
            <b>Auto</b>
            <span>4 coral L4 · 2 algae</span>
            <small>Observed</small>
          </li>
          <li>
            <b>Tele</b>
            <span>Cycle 18s · climb L3</span>
            <small>Observed</small>
          </li>
          <li>
            <b>Voice</b>
            <span>“Defended hard mid-field”</span>
            <small>Note</small>
          </li>
        </ul>
        <footer className="product-demo-footer">
          <span>Forms keep working offline</span>
          <b>Sync when online</b>
        </footer>
      </div>
    </div>
  );
}

export function DashboardPreview() {
  return (
    <div className="product-demo compact ops-demo" aria-label="Demo customizable dashboard preview">
      <DemoChrome title="Home · Customizable dashboard" meta="Widget board" />
      <div className="ops-demo-body dash-ops">
        <div className="dash-ops-grid">
          <article>
            <span>Next match</span>
            <strong>Q42</strong>
            <small>Waiting on event</small>
          </article>
          <article>
            <span>Readiness</span>
            <strong>—</strong>
            <small>No fabricated %</small>
          </article>
          <article>
            <span>Alerts</span>
            <strong>0</strong>
            <small>Empty until linked</small>
          </article>
          <article>
            <span>Scouting</span>
            <strong>—</strong>
            <small>Coverage after sync</small>
          </article>
        </div>
        <footer className="product-demo-footer">
          <span>Customize rearranges widgets</span>
          <b>Empty ≠ fake stats</b>
        </footer>
      </div>
    </div>
  );
}

export function DisplayPreview() {
  return (
    <div className="product-demo compact ops-demo" aria-label="Demo pit TV display preview">
      <DemoChrome title="Pit / TV · Next match board" meta="Kiosk" />
      <div className="ops-demo-body tv-ops">
        <div className="tv-ops-hero">
          <span>ON DECK</span>
          <strong>Q42</strong>
          <b>Red · Field 2</b>
        </div>
        <div className="ops-demo-stat-row">
          <div>
            <span>Leave pit</span>
            <strong>6:40</strong>
          </div>
          <div>
            <span>Alliance</span>
            <strong>254 · 1678 · 118</strong>
          </div>
        </div>
        <footer className="product-demo-footer">
          <span>Offline-aware kiosk</span>
          <b>Pit &amp; stands</b>
        </footer>
      </div>
    </div>
  );
}

export function TeamOpsPreview() {
  return (
    <div className="product-demo compact ops-demo" aria-label="Demo team invites and usage controls">
      <DemoChrome title="Team · Invites &amp; usage" meta="Org-scoped" />
      <div className="ops-demo-body team-ops">
        <ul>
          <li>
            <b>Invite</b>
            <span>mentor@team.frc · pending</span>
            <small>Email</small>
          </li>
          <li>
            <b>Role</b>
            <span>Student scout · org member</span>
            <small>Scoped</small>
          </li>
          <li>
            <b>AI budget</b>
            <span>Used 42 / 200 credits</span>
            <small>Hard cap</small>
          </li>
          <li>
            <b>Privacy</b>
            <span>Row-level org boundaries</span>
            <small>Enforced</small>
          </li>
        </ul>
        <footer className="product-demo-footer">
          <span>Waitlist + invite only</span>
          <b>Platform admin gated separately</b>
        </footer>
      </div>
    </div>
  );
}

export function AssistantPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`product-demo assistant-product-demo ${compact ? "compact" : ""}`}
      aria-label="Demo data preview of the FRC Assistant"
    >
      <DemoChrome title="FRC Assistant · Qual 42 context" meta="Event-scoped · source-labeled" />
      <div className={`marketing-demo-board ${compact ? "compact-board" : ""}`}>
        <article className="app-card">
          <header>
            <span className="app-badge demo">Demo data</span>
            <h2>Grounded competition ask</h2>
          </header>
          <p className="app-muted">
            Strategy, matchups, and scout-attributed notes in one event context—without inventing confidence.
          </p>
        </article>
      </div>
    </div>
  );
}

export function WorkflowStrip() {
  return (
    <ol className="unified-flow" aria-label="Unified Vantage workflow">
      {["Scout", "Predict", "Strategize", "CAD", "Code", "Maintain"].map((stage, index) => (
        <li key={stage}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <span>{stage}</span>
          {index < 5 && <i aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
