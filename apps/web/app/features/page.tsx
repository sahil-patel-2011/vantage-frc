import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "Implemented features — Vantage",
  description: "A factual overview of implemented Vantage scouting, intelligence, strategy, display, CAD, and coding workflows.",
  alternates: { canonical: "/features" },
};

const capabilities = [
  { status: "Available", title: "Offline scouting", detail: "Versioned match and pit forms, local capture, media hooks, confidence, disagreement review, and deliberate sync." },
  { status: "Requires setup", title: "Live event intelligence", detail: "TBA and Statbotics-backed reference caches, freshness state, team lookup, comparisons, pick lists, and reliability context. A data connector must be configured." },
  { status: "Available", title: "Strategy and prediction", detail: "Match plans and prediction records keep input versions, confidence, key factors, outcomes, and accuracy history distinct." },
  { status: "Requires setup", title: "AI CAD builder", detail: "Confirmed engineering briefs, approval-gated steps, Onshape hosted jobs, Fusion relay jobs, and geometry checkpoints. Provider and CAD connections are required." },
  { status: "Requires setup", title: "Contextual assistant", detail: "Private or team-scoped threads, explicit memory controls, budgets, and provider routing. AI access depends on team policy and configured providers." },
  { status: "Available", title: "Event display", detail: "Board setup, saved presets, public snapshot tokens, and a high-contrast kiosk view for pit and stands displays." },
];

export default function FeaturesPage() {
  return <div className="marketing-site"><SiteHeader /><main className="route-page">
    <header className="route-hero"><span className="section-id">IMPLEMENTED PRODUCT</span><h1>Concrete workflows, with setup state made explicit.</h1><p>These capabilities map to routes, data models, and tests in the current Vantage application. Demo previews are labeled; credential-gated integrations are not presented as ready until configured.</p></header>
    <section className="feature-state-grid" aria-label="Vantage capability states">
      {capabilities.map((item) => <article key={item.title}><span className={`status-badge ${item.status === "Available" ? "available" : "setup"}`}>{item.status}</span><h2>{item.title}</h2><p>{item.detail}</p>{item.title === "AI CAD builder" && <a className="text-link" href="/features/cad">Review the CAD workflow →</a>}</article>)}
    </section>
    <section className="real-screen">
      <div><span className="section-id">DEMO DATA / SCOUTING SCREEN</span><h2>Capture remains usable when venue connectivity does not.</h2><p>The implemented scouting client exposes online/offline state, assigned event context, versioned forms, voice notes, media attachments, and conflict review.</p></div>
      <div className="screen-frame scouting-frame" aria-label="Demo representation of the implemented scouting form">
        <header><strong>VANTAGE / SCOUTING</strong><span>DEMO DATA</span><b>OFFLINE READY</b></header>
        <div><aside><span>QUALIFICATION 42</span><strong>Team 254</strong><small>Form schema · match-v3</small></aside><section><label>Auto notes<input value="Center start; 4-piece observed" readOnly /></label><label>Confidence<select value="high" disabled><option value="high">High</option></select></label><button type="button" disabled>Save locally</button></section></div>
      </div>
    </section>
  </main><SiteFooter /></div>;
}
