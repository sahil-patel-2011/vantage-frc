import { WaitlistForm } from "../src/waitlist-form";

const capabilities = [
  ["01", "Scouting", "Capture versioned match and pit observations offline, then sync without losing attribution."],
  ["02", "Team Intel", "Combine hard performance metrics with durable research findings and your team’s own context."],
  ["03", "Strategy", "Turn predictions, reliability, and scouting evidence into reusable match plans."],
  ["04", "Live Event Ops", "Keep the next match, walk time, surprises, and coach decisions in one active event context."],
  ["05", "Prediction", "See win probabilities, confidence ranges, key factors, and an honest accuracy record."],
  ["06", "CAD + Coding", "Connect strategy to Onshape cloud jobs, a local Fusion relay, and robot-code assistance."],
  ["07", "Research", "Run source-linked, season-aware research without presenting unverified web claims as hard data."],
  ["08", "Maintenance", "Keep failures, repair evidence, batteries, and practice context available to future decisions."],
  ["09", "Team Operations", "Carry the same durable context into roster, judging, outreach, finance, and shop workflows."]
];

export default function Home() {
  return (
    <>
      <header className="nav">
        <a className="wordmark" href="#top" aria-label="Vantage home"><span>V</span> VANTAGE</a>
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a><a href="#flow">How it works</a><a href="/pricing">Pricing</a>
        </nav>
        <a className="button compact" href="#waitlist">Join waitlist</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><i /> COMPETITION TELEMETRY / EARLY ACCESS</div>
          <h1>One source of truth for your whole FRC season.</h1>
          <p className="hero-copy">
            Vantage connects scouting, event data, strategy, prediction, CAD, and code into one durable
            operational picture—built for FIRST Robotics Competition teams.
          </p>
          <div className="actions">
            <a className="button primary" href="#waitlist">Join the waitlist</a>
            <a className="button ghost" href="#product">See the system ↓</a>
          </div>
          <div className="match-board" aria-label="Data flowing into a Vantage match brief">
            <div className="board-head"><span>VANTAGE / MATCH BRIEF</span><b>QUAL 42</b><em>LIVE CONTEXT</em></div>
            <div className="sources">
              <article><small>SCOUT INPUT</small><strong>High-note cycle</strong><span>Confidence: high</span></article>
              <article><small>EVENT METRICS</small><strong>EPA +18.7</strong><span>Trend: +2.4 / match</span></article>
              <article><small>RESEARCH</small><strong>Intake revision</strong><span>Verified at event</span></article>
            </div>
            <div className="flow-line"><i /><i /><i /><b>V</b></div>
            <div className="brief">
              <span>ALLIANCE PLAN / REV 03</span>
              <h2>Protect the center lane. Shift cycle priority at 0:45.</h2>
              <div><b>68%</b> projected win chance <mark>± 9%</mark></div>
            </div>
          </div>
        </section>

        <section className="fragment" id="product">
          <div><span className="section-id">SYSTEM / 01</span><h2>Your season is already generating the answers.</h2></div>
          <p>They’re just split across spreadsheets, scouting forms, stat sites, chat threads, CAD, and robot code.</p>
          <div className="silos" aria-label="Disconnected tools becoming a shared data layer">
            {["SCOUTING", "TBA + STATBOTICS", "RESEARCH", "CAD", "ROBOT CODE"].map((name) => <span key={name}>{name}</span>)}
            <strong>ONE SHARED VANTAGE DATA LAYER</strong>
          </div>
        </section>

        <section className="capabilities">
          <header><span className="section-id">ONE CONTEXT / EVERY WORKFLOW</span><h2>Built around the decisions teams make.</h2></header>
          <div className="cap-grid">
            {capabilities.map(([id, title, copy]) => (
              <article key={id}><span>{id}</span><div className="mini-ui"><i /><i /><i /></div><h3>{title}</h3><p>{copy}</p></article>
            ))}
          </div>
        </section>

        <section className="event-flow" id="flow">
          <span className="section-id">EVENT DAY / ACTIVE CONTEXT</span>
          <h2>One deliberate context switch. Every module follows.</h2>
          <ol>
            <li><b>BEFORE EVENT</b><span>Sync schedules, metrics, and assigned scouting forms.</span></li>
            <li><b>IN THE STANDS</b><span>Capture offline observations with confidence and attribution.</span></li>
            <li><b>NEXT MATCH</b><span>Merge predictions, scouting, and research into one coach brief.</span></li>
            <li><b>POST-MATCH</b><span>Record outcomes, review misses, and improve the next plan.</span></li>
          </ol>
        </section>

        <section className="controls" id="controls">
          <div><span className="section-id">AI / CONTROLLED</span><h2>Useful intelligence. Visible limits.</h2></div>
          <div className="control-grid">
            <article><b>FREE</b><h3>Bring your own key</h3><p>Encrypted with envelope encryption. Your provider key is never stored in plaintext.</p></article>
            <article><b>VANTAGE PRO + MAX</b><h3>Managed usage</h3><p>Published monthly plans with configurable included allowances, team caps, per-member visibility, and a ledger behind every AI action.</p></article>
            <article><b>ADMIN</b><h3>No surprise spend</h3><p>Hard limits are checked before provider calls, with kill switches and audited grants.</p></article>
          </div>
        </section>

        <section className="specific">
          <span className="section-id">FRC-LITERATE BY DESIGN</span>
          <h2>The details aren’t edge cases here.</h2>
          <ul>
            <li>TBA and Statbotics reference data</li><li>Offline-first venue workflows</li>
            <li>Fusion execution on your desktop</li><li>Onshape execution in the cloud</li>
          </ul>
        </section>

        <section className="waitlist" id="waitlist">
          <div><span className="section-id">EARLY ACCESS</span><h2>Get the launch signal.</h2>
            <p>Join the prelaunch list. At launch, you’ll still explicitly create and verify your account, accept the current terms, and create or join an organization.</p>
          </div>
          <WaitlistForm />
        </section>
      </main>
      <footer>
        <a className="wordmark" href="#top"><span>V</span> VANTAGE</a>
        <p>Competition telemetry for the whole season.</p>
        <nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:hello@vantagefrc.com">Contact</a></nav>
      </footer>
    </>
  );
}
