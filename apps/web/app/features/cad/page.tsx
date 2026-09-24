import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
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
    lines: ["Constraints listed", "You approve first", "Empty until written"],
  },
  {
    title: "Connectors",
    copy: "Onshape OAuth or Fusion relay.",
    frame: "Setup",
    lines: ["Onshape hosted", "Fusion desktop", "Sign in once"],
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
          <p className="lux-kicker">CAD agent</p>
          <h1>CAD starts with a brief.</h1>
          <p>
            You confirm a short design brief first, and nothing changes in your CAD until you approve it.
            Connect Onshape with one click, or Fusion through the Vantage desktop app.
            Nothing changes in your CAD until a person approves the step.
          </p>
          <MarketingRouteActions
            companion={{ href: "/features", label: "Product overview", variant: "secondary" }}
          />
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
              <a href="/pricing">Free, with your own AI key</a>
            </p>
          </div>
          <MarketingRouteActions
            className="pricing-preview-actions"
            guestLabel="Join waitlist"
            companion={{ href: "/workflow", label: "How it works", variant: "secondary" }}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
