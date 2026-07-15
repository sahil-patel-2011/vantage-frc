import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";

const decisionLayers = [
  ["01", "Observe", "Versioned scouting works in the stands, offline, with confidence and attribution intact."],
  ["02", "Understand", "Official event data, team research, and your own observations share one active-event context."],
  ["03", "Decide", "Strategy and prediction outputs stay connected to their evidence, assumptions, and revisions."],
  ["04", "Build", "Confirmed decisions can move into controlled CAD and coding workflows without losing context."],
];

export default function Home() {
  return (
    <div className="marketing-site">
      <SiteHeader />

      <main id="top">
        <section className="hero">
          <div className="hero-intro">
            <span className="eyebrow">OPERATIONS SOFTWARE FOR FRC TEAMS</span>
            <h1>One reliable context for every competition decision.</h1>
            <p className="hero-copy">
              Vantage connects scouting, strategy, prediction, CAD, and robot code around the same
              event evidence—so teams can move from observation to action without rebuilding context.
            </p>
            <div className="actions">
              <a className="button primary" href="#hero-email">Join the waitlist</a>
              <a className="text-link" href="/workflow">See how the system works →</a>
            </div>
            <p className="hero-note">Invite-only early access for FRC teams. No account is created by joining.</p>
          </div>

          <aside className="hero-waitlist" id="hero-waitlist" aria-labelledby="hero-waitlist-title">
            <span className="section-id">EARLY ACCESS</span>
            <h2 id="hero-waitlist-title">Get the launch signal.</h2>
            <WaitlistForm idPrefix="hero" compact />
          </aside>

          <div className="product-preview" aria-label="Example Vantage decision brief">
            <header><div><span>DEMO DATA / WORKSPACE</span><strong>2026 Regional</strong></div><div><span>NEXT MATCH</span><strong>Qualification 42</strong></div><b>AVAILABLE</b></header>
            <div className="preview-body">
              <aside>
                <span>INPUTS</span>
                <ul><li>Scouting observations <b>18</b></li><li>Official match records <b>36</b></li><li>Source-linked findings <b>7</b></li></ul>
              </aside>
              <article>
                <span>STRATEGY BRIEF / REV 03</span>
                <h2>Recommendations remain traceable to team evidence.</h2>
                <p>Confidence, freshness, and unresolved disagreements stay visible before a coach approves the plan.</p>
                <div><span>SCOUTING</span><span>PREDICTION</span><span>CAD + CODE CONTEXT</span></div>
              </article>
            </div>
          </div>
        </section>

        <section className="system-story" id="system">
          <div className="section-heading"><span className="section-id">ONE CONTEXT / THE WHOLE LOOP</span><h2>Stop rebuilding the same decision in five tools.</h2></div>
          <p className="section-lede">Vantage is organized around the competition loop, not a catalog of disconnected features. <a className="text-link" href="/features">Review implemented features →</a></p>
          <div className="decision-grid">
            {decisionLayers.map(([id, title, copy]) => <article key={id}><span>{id}</span><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <section className="workflow-story" id="workflow">
          <div>
            <span className="section-id">ACTIVE EVENT CONTEXT</span>
            <h2>Set the event once. Every authorized workflow follows.</h2>
            <p>Schedules, reference metrics, scouting assignments, research, and the next-match queue align to one deliberate team context. Source freshness and offline state remain visible.</p>
            <a className="text-link" href="/pricing">Review straightforward pricing →</a>
          </div>
          <ol>
            <li><b>01</b><span><strong>Capture</strong>Assigned forms continue offline and retain authorship.</span></li>
            <li><b>02</b><span><strong>Reconcile</strong>Conflicts and confidence are reviewed, not hidden.</span></li>
            <li><b>03</b><span><strong>Plan</strong>Predictions and recommendations cite current inputs.</span></li>
            <li><b>04</b><span><strong>Execute</strong>Approved intent moves into pit, CAD, and code work.</span></li>
          </ol>
        </section>

        <section className="technical-proof">
          <div className="section-heading"><span className="section-id">BUILT FOR VENUE REALITY</span><h2>Technical controls that earn trust.</h2></div>
          <div className="proof-grid">
            <article><h3>Offline by design</h3><p>Scouting captures locally, syncs deliberately, and surfaces disagreements instead of overwriting them.</p></article>
            <article><h3>Evidence stays attached</h3><p>Observations, official metrics, research claims, and generated recommendations keep distinct provenance.</p></article>
            <article><h3>Engineering actions are reviewed</h3><p>CAD mutations require a confirmed brief and checkpoints; coding context remains scoped to authorized work.</p></article>
          </div>
        </section>

        <section className="waitlist" id="waitlist">
          <div><span className="section-id">EARLY ACCESS</span><h2>Bring your team’s workflows into one operational picture.</h2>
            <p>Join the prelaunch list. At launch, you will explicitly verify your account and accept current terms. Team access remains administrator-created and invite-only.</p>
          </div>
          <WaitlistForm idPrefix="final" />
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
