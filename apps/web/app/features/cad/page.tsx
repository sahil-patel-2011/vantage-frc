import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "AI CAD builder — Vantage",
  description: "Approval-gated CAD briefs for Onshape or Fusion—setup required until connectors are configured.",
  alternates: { canonical: "/features/cad" },
};

export default function CadFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>CAD starts with a brief.</h1>
          <p>Onshape hosted jobs or a Fusion desktop relay—credentials required. No unreviewed mutations.</p>
          <div className="actions">
            <a className="button primary" href="/signin">
              Sign in
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </header>

        <section className="lux-showcase">
          <header className="lux-section-head">
            <h2>Confirm. Connect. Review.</h2>
          </header>
          <div className="product-glances" aria-label="CAD workflow preview">
            <article className="product-glance">
              <h3>Brief</h3>
              <p>Intent before geometry.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>CAD brief</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Constraints listed</li>
                  <li>Human gate first</li>
                  <li>Empty until written</li>
                </ul>
              </div>
            </article>
            <article className="product-glance">
              <h3>Connectors</h3>
              <p>Onshape OAuth or Fusion relay.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>Setup</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Onshape hosted</li>
                  <li>Fusion desktop</li>
                  <li>Setup required</li>
                </ul>
              </div>
            </article>
            <article className="product-glance">
              <h3>Review</h3>
              <p>Per-step approvals stay with the team.</p>
              <div className="product-glance-frame" aria-hidden="true">
                <header>
                  <span>Controls</span>
                  <b>Preview</b>
                </header>
                <ul>
                  <li>Step status</li>
                  <li>Checkpoints</li>
                  <li>Artifacts labeled</li>
                </ul>
              </div>
            </article>
            <p className="product-glances-note">Marketing preview. CAD stays setup-required until connected.</p>
          </div>
        </section>

        <section className="technical-note">
          <span className="section-id">BOUNDARY</span>
          <h2>AI is not engineering certification.</h2>
          <p>Teams own fit, loads, materials, rules, and safety.</p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
