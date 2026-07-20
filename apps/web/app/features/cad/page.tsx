import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "AI CAD builder — Vantage",
  description:
    "The implemented Vantage CAD workflow: confirmed briefs, connector setup, approval gates, job steps, and geometry checkpoints.",
  alternates: { canonical: "/features/cad" },
};

export default function CadFeaturePage() {
  return (
    <div className="marketing-site marketing-v2 marketing-dense marketing-quiet">
      <SiteHeader />
      <main className="route-page">
        <header className="route-hero brand-route-hero">
          <p className="brand-hero-wordmark route-wordmark">Vantage</p>
          <span className="section-id">AI CAD BUILDER · SETUP REQUIRED</span>
          <h1>Start with engineering intent, not an unreviewed mutation.</h1>
          <p>
            Onshape hosted jobs and a paired Fusion 360 desktop relay. Both require configured credentials—Vantage does
            not claim to control a local CAD session from Vercel.
          </p>
          <div className="route-hero-actions">
            <a className="button primary" href="/signin">
              Sign in to configure access
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </header>

        <section className="ops-preview-band product-show">
          <header>
            <span className="section-id">WORKFLOW</span>
            <h2>Confirm the brief. Approve each step.</h2>
            <p>Marketing preview of the CAD path—not live geometry.</p>
          </header>
          <div className="product-glances" aria-label="CAD workflow preview">
            <article className="product-glance">
              <h3>Brief</h3>
              <p>Season constraints become an engineering thread before any mutation.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>CAD brief</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Intent confirmed</li>
                  <li>Constraints listed</li>
                  <li>Human gate first</li>
                </ul>
              </div>
            </article>
            <article className="product-glance">
              <h3>Connectors</h3>
              <p>Onshape OAuth or a paired Fusion relay when credentials exist.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>Setup</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Onshape hosted</li>
                  <li>Fusion desktop relay</li>
                  <li>Empty until connected</li>
                </ul>
              </div>
            </article>
            <article className="product-glance">
              <h3>Review</h3>
              <p>Per-step status, approvals, and checkpoints—teams stay responsible for engineering judgment.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>Controls</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Step approvals</li>
                  <li>Topology checks</li>
                  <li>Artifacts labeled</li>
                </ul>
              </div>
            </article>
            <p className="product-glances-note">
              Marketing preview. Signed-in CAD stays setup-required until connectors are configured.
            </p>
          </div>
        </section>

        <section className="technical-note">
          <span className="section-id">BOUNDARY</span>
          <h2>AI assistance is not engineering certification.</h2>
          <p>
            Review flags and generated geometry are suggestions. Teams remain responsible for fit, loads, materials,
            rules compliance, manufacturing, and safety review.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
