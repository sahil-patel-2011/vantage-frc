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
              <article><small>EVENT METRICS</small><strong>Official cache</strong><span>Freshness visible</span></article>
              <article><small>RESEARCH</small><strong>Source-linked claim</strong><span>Confidence visible</span></article>
            </div>
            <div className="flow-line"><i /><i /><i /><b>V</b></div>
            <div className="brief">
              <span>ALLIANCE PLAN / REV 03</span>
              <h2>Recommendations stay linked to evidence and revision history.</h2>
              <div><b>MODEL STATUS</b> awaiting current inputs <mark>no invented result</mark></div>
            </div>
          </div>
        </section>

        <section className="cad-signature">
          <div><span className="section-id">SIGNATURE WORKFLOW / AI CAD</span><h2>Strategy becomes a confirmed engineering brief—then verified geometry.</h2></div>
          <p>Bring authorized match, scouting, research, and mechanism context into one versioned CAD conversation. Confirm requirements and assumptions before any mutation, approve risky actions one at a time, and inspect a topology/render checkpoint after every change.</p>
          <div className="control-grid">
            <article><b>ONSHAPE HOSTED</b><h3>OAuth + server worker</h3><p>Select a document/workspace/element, preview the allowlisted plan, then checkpoint and verify supported features or reviewed FeatureScript.</p></article>
            <article><b>FUSION 360 LOCAL</b><h3>Signed desktop jobs</h3><p>A paired relay drives Fusion only in your Autodesk desktop session. Vercel never pretends to run local CAD.</p></article>
            <article><b>ENGINEERING CONTROL</b><h3>Human confirmation first</h3><p>Compare versions, detect human edits, connect BOM/tasks, and treat review flags as suggestions—not safety certification.</p></article>
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
          <h2>Provenance and resilience are the product.</h2>
          <ul>
            <li>Shared TBA cache with visible freshness</li><li>Offline-first venue workflows and transparent sync</li>
            <li>Evidence taxonomy across observations, metrics, predictions, and recommendations</li><li>Onshape hosted and Fusion desktop execution paths</li>
          </ul>
        </section>

        <section className="waitlist" id="waitlist">
          <div><span className="section-id">EARLY ACCESS</span><h2>Get the launch signal.</h2>
            <p>Join the prelaunch list. At launch, you’ll explicitly verify your account and accept current terms; team access remains administrator-created and invite-only.</p>
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
