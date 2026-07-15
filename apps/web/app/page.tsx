import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { CadPreview, CodePreview, StrategyPreview, WorkflowStrip } from "../components/marketing/product-demos";

const operations = [
  ["Offline scouting", "Assigned match and pit forms keep attribution, confidence, media hooks, and conflict review through venue connectivity changes."],
  ["Active event command", "One deliberate event context drives next-match queue, team controls, reference freshness, and display setup."],
  ["Pit and stands displays", "Saved boards and public snapshot tokens feed purpose-built high-contrast kiosk views."],
  ["Maintenance handoff", "Failures, fouls, battery state, and debrief prompts carry forward instead of disappearing after the match."],
];

export default function Home() {
  return <div className="marketing-site marketing-v2"><SiteHeader/><main>
    <section className="v2-hero">
      <div className="v2-hero-copy"><span className="section-id">COMPETITION OPERATIONS FOR FRC</span><h1>One shared context—from match data to robot decisions.</h1><p>Vantage connects scouting, prediction, strategy, CAD, and code around the same event evidence so coaches, mentors, and students can move with confidence.</p><div className="actions"><a className="button primary" href="#hero-email">Join the waitlist</a><a className="button secondary" href="/features">Explore the product</a></div><div className="hero-trust"><span>Offline-aware</span><span>Source-linked</span><span>Approval-gated</span></div></div>
      <div className="hero-product-composition"><div className="composition-label"><span>DEMO</span><b>Competition Command Center</b></div><StrategyPreview compact/><div className="composition-queue"><span>NEXT MATCH</span><strong>Qualification 42</strong><div><b>18:24</b><small>walk in 6 minutes</small></div></div><div className="composition-state"><span>ROBOT READINESS</span><b>3 checks remaining</b><i style={{width:"72%"}}/></div></div>
      <aside className="hero-waitlist" id="hero-waitlist" aria-labelledby="hero-waitlist-title"><span className="section-id">EARLY ACCESS</span><h2 id="hero-waitlist-title">Bring one team context into the next event.</h2><WaitlistForm idPrefix="hero" compact/></aside>
    </section>

    <section className="signature-intro"><span className="section-id">SIGNATURE ENGINES</span><h2>From evidence to an action your team can review.</h2><p>Three substantial workflows share the same provenance and approval model. Each preview uses deterministic demo data and reflects implemented product behavior.</p></section>

    <section className="signature-section strategy-signature"><div className="signature-copy"><span className="app-badge good">Available</span><small>01 / WIN–LOSS + STRATEGY</small><h2>See the probability. Inspect the factors. Build the playbook.</h2><p>The weighted-current model reports confidence, effective sample size, key factors, and caveats. What-if changes remain explicit assumptions; playbooks preserve priorities and debrief prompts.</p><ul><li>Probability and confidence interval</li><li>What-if, defense, and role planning</li><li>Outcome accuracy and Brier score history</li></ul><a className="text-link" href="/features/strategy">Explore the Strategy Engine →</a></div><StrategyPreview/></section>

    <section className="signature-section cad-signature-v2"><CadPreview/><div className="signature-copy"><span className="app-badge setup">Connectors require setup</span><small>02 / AI CAD BUILDER</small><h2>Confirm engineering intent before geometry changes.</h2><p>A strategy-linked brief becomes requirements, assumptions, a reviewed action plan, approval-gated steps, and verified topology/render checkpoints.</p><ul><li>Onshape hosted path with configured OAuth</li><li>Fusion 360 execution through a paired local relay</li><li>Versioned artifacts, checkpoints, and BOM context</li></ul><a className="text-link" href="/features/cad">Explore the CAD Builder →</a></div></section>

    <section className="signature-section code-signature"><div className="signature-copy"><span className="app-badge good">Available</span><small>03 / FRC CODE REVIEW</small><h2>Find robot-code risk before it reaches hardware.</h2><p>Repository-aware reviews identify WPILib and vendor-pattern risks, attach file evidence, and package proposed changes as human-approved unified diffs.</p><ul><li>Blocking loops, CAN IDs, units, and disabled-state checks</li><li>Test, simulation, and code-freeze artifacts</li><li>Proposal only—no autonomous robot deployment claim</li></ul><a className="text-link" href="/features/code">Explore Code Review →</a></div><CodePreview/></section>

    <section className="workflow-band"><header><span className="section-id">ONE CONTEXT / SIX HANDOFFS</span><h2>The competition loop stays connected.</h2><p>Sources, organization scope, active event, assumptions, and approvals travel with the work.</p></header><WorkflowStrip/><a className="text-link" href="/workflow">See the complete system workflow →</a></section>

    <section className="ops-proof"><header><span className="section-id">COMPETITION OPERATIONS</span><h2>Built for the moments around the signature engines.</h2></header><div>{operations.map(([title,copy],index)=><article key={title}><b>{String(index+1).padStart(2,"0")}</b><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

    <section className="trust-controls"><div><span className="section-id">TRUST / CONTROL</span><h2>Technical controls are part of the product.</h2></div><ul><li><strong>Team-private boundaries</strong><span>Organization context and row-level database policies scope protected work.</span></li><li><strong>Visible sources</strong><span>Official metrics, observations, research, predictions, and model inference remain distinct.</span></li><li><strong>Usage limits</strong><span>Provider policy, budgets, and hard caps are checked before managed calls.</span></li><li><strong>Approval gates</strong><span>CAD mutation and code proposals remain reviewable human decisions.</span></li></ul></section>

    <section className="pricing-preview"><div><span className="section-id">PRICING</span><h2>Start with the complete non-AI competition core.</h2><p>Free supports scouting, reference data, manual strategy, exports, and team operations. Paid individual and team plans fund managed AI deliberately, with published credits and hard controls.</p></div><a className="button secondary" href="/pricing">Review plans and controls</a></section>

    <section className="waitlist v2-final-waitlist" id="waitlist"><div><span className="section-id">EARLY ACCESS</span><h2>Put one operational picture in front of the whole team.</h2><p>Join the prelaunch list. Account verification, current terms, and administrator-created team access remain separate launch steps.</p></div><WaitlistForm idPrefix="final"/></section>
  </main><SiteFooter/></div>;
}
