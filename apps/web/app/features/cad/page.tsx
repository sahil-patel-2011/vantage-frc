import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "CAD agent — Vantage",
  description:
    "Approval-gated CAD briefs for Onshape or Fusion on the Build hub. Connectors required before jobs run. No unreviewed mutations.",
  path: "/features/cad",
});

const steps = [
  {
    title: "Brief",
    copy: "Intent before geometry.",
    frame: "CAD brief",
    lines: ["Constraints listed", "Human gate first", "Empty until written"],
  },
  {
    title: "Connectors",
    copy: "Onshape OAuth or Fusion relay.",
    frame: "Setup",
    lines: ["Onshape hosted", "Fusion desktop", "Credentials required"],
  },
  {
    title: "Review",
    copy: "Per-step approvals stay with the team.",
    frame: "Controls",
    lines: ["Step status", "Checkpoints", "Artifacts labeled"],
  },
] as const;

export default function CadFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>CAD starts with a brief.</h1>
          <p>
            Build hub CAD agent: Onshape hosted jobs or a Fusion desktop relay—credentials required. No unreviewed
            mutations.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>Confirm. Connect. Review.</h2>
              <p>Build hub · CAD tab. Connect Onshape or Fusion before briefs run.</p>
            </header>
            <ul className="lux-feature-grid">
              {steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>
                    {step.copy} {step.lines.join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="technical-note lux-content">
          <span className="section-id">BOUNDARY</span>
          <h2>AI is not engineering certification.</h2>
          <p>Teams own fit, loads, materials, rules, and safety.</p>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Related.</h2>
            <p>
              <a href="/features/strategy">Strategy & Assistant</a> · <a href="/features/code">Code Coach</a> ·{" "}
              <a href="/pricing">Pricing</a>
            </p>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/workflow">
              How it works
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
