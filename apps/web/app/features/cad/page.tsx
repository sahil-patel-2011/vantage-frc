import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "AI CAD builder — Vantage",
  description: "The implemented Vantage CAD workflow: confirmed briefs, connector setup, approval gates, job steps, and geometry checkpoints.",
  alternates: { canonical: "/features/cad" },
};

export default function CadFeaturePage() {
  return <div className="marketing-site marketing-v2"><SiteHeader /><main className="route-page">
    <header className="route-hero split-hero"><div><span className="section-id">AI CAD BUILDER / SETUP REQUIRED</span><h1>Start with engineering intent, not an unreviewed mutation.</h1><p>The current product supports Onshape hosted jobs and a paired Fusion 360 desktop relay. Both require configured credentials or connections; Vantage does not claim to control a local CAD session from Vercel.</p><a className="button primary" href="/signin">Sign in to configure access</a></div>
      <div className="cad-screen" aria-label="Demo data representation of the implemented CAD builder"><header><span>DEMO DATA</span><b>BRIEF CONFIRMED</b></header><section><small>ENGINEERING THREAD</small><h2>Intake roller guard</h2><p>Keep the frame perimeter clear. Use existing 10-32 mounting locations. Flag any interference before export.</p><ol><li><b>01</b> Sketch envelope <span>Completed</span></li><li><b>02</b> Extrude guard <span>Awaiting approval</span></li><li><b>03</b> Verify topology <span>Queued</span></li></ol></section></div>
    </header>
    <section className="cad-paths">
      <article><span className="app-badge setup">Setup required*</span><h2>Onshape hosted</h2><p>Connect OAuth when ONSHAPE_OAUTH_* is configured, select a document/workspace/element, preview an allowlisted plan, approve required steps, and inspect topology/render checkpoints after mutations. *Enabled automatically once admin credentials exist.</p></article>
      <article><span className="app-badge good">Local relay</span><h2>Fusion 360 (Win/mac)</h2><p>Pair a signed desktop relay. Jobs use leases and heartbeats; execution stays inside the user’s Autodesk session. Linux: Fusion Autodesk app unavailable — use Onshape or mock.</p></article>
      <article><span className="app-badge good">Available</span><h2>Review controls</h2><p>Brief confirmation, per-step status, approval requirements, artifacts, checksums, and current checkpoint references are implemented in the CAD workspace. Demo renders are labeled — never presented as live production geometry.</p></article>
    </section>
    <section className="technical-note"><span className="section-id">OS MATRIX</span><h2>Installers and platforms</h2><p>CLI install scripts: <code>scripts/cad/install-cli.ps1</code> / <code>install-cli.sh</code>. Fusion add-in: <code>install-fusion-addin.ps1</code> / <code>.sh</code>. Unsigned package: <code>node scripts/cad/package-relay.mjs</code>. Docs: CAD_RELAY.md.</p></section>
    <section className="technical-note"><span className="section-id">BOUNDARY</span><h2>AI assistance is not engineering certification.</h2><p>Review flags and generated geometry are suggestions. Teams remain responsible for fit, loads, materials, rules compliance, manufacturing, and safety review.</p></section>
  </main><SiteFooter /></div>;
}
