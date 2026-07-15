import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "AI CAD builder — Vantage",
  description: "The implemented Vantage CAD workflow: confirmed briefs, connector setup, approval gates, job steps, and geometry checkpoints.",
  alternates: { canonical: "/features/cad" },
};

export default function CadFeaturePage() {
  return <div className="marketing-site"><SiteHeader /><main className="route-page">
    <header className="route-hero split-hero"><div><span className="section-id">AI CAD BUILDER / REQUIRES SETUP</span><h1>Start with engineering intent, not an unreviewed mutation.</h1><p>The current product supports Onshape hosted jobs and a paired Fusion 360 desktop relay. Both require configured credentials or connections; Vantage does not claim to control a local CAD session from Vercel.</p><a className="button primary" href="/signin">Sign in to configure access</a></div>
      <div className="cad-screen" aria-label="Demo data representation of the implemented CAD builder"><header><span>DEMO DATA</span><b>BRIEF CONFIRMED</b></header><section><small>ENGINEERING THREAD</small><h2>Intake roller guard</h2><p>Keep the frame perimeter clear. Use existing 10-32 mounting locations. Flag any interference before export.</p><ol><li><b>01</b> Sketch envelope <span>Completed</span></li><li><b>02</b> Extrude guard <span>Awaiting approval</span></li><li><b>03</b> Verify topology <span>Queued</span></li></ol></section></div>
    </header>
    <section className="cad-paths">
      <article><span className="status-badge setup">Requires setup</span><h2>Onshape hosted</h2><p>Connect OAuth, select a document/workspace/element, preview an allowlisted plan, approve required steps, and inspect topology/render checkpoints after mutations.</p></article>
      <article><span className="status-badge setup">Requires setup</span><h2>Fusion 360 local relay</h2><p>Pair a signed desktop relay to the authenticated user and organization. Jobs use leases and heartbeats; execution remains inside the user’s Autodesk desktop session.</p></article>
      <article><span className="status-badge available">Available</span><h2>Review controls</h2><p>Brief confirmation, per-step status, approval requirements, artifacts, checksums, and current checkpoint references are implemented in the CAD workspace.</p></article>
    </section>
    <section className="technical-note"><span className="section-id">BOUNDARY</span><h2>AI assistance is not engineering certification.</h2><p>Review flags and generated geometry are suggestions. Teams remain responsible for fit, loads, materials, rules compliance, manufacturing, and safety review.</p></section>
  </main><SiteFooter /></div>;
}
