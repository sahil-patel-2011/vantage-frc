import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "CAD agent — Vantage",
  description:
    "Describe a part, and Vantage proposes each CAD step in Onshape or Fusion 360. Nothing changes until someone on your team approves it.",
  path: "/features/cad",
});

const steps = [
  {
    title: "Describe the part",
    copy: "Say what it has to do, what it attaches to and any limits. You check the short brief before anything is drawn.",
  },
  {
    title: "Connect once",
    copy: "Sign in to Onshape in the browser, or open Fusion 360 with the Vantage desktop app. That is the whole setup.",
  },
  {
    title: "Approve each step",
    copy: "Vantage proposes one change at a time and waits. You approve it, change it, or stop.",
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
            You confirm a short design brief first. Connect Onshape with one click, or Fusion 360 through the
            Vantage desktop app. Nothing changes in your CAD until a person on your team approves the step.
          </p>
          <MarketingRouteActions
            companion={{ href: "/features", label: "Product overview", variant: "secondary" }}
          />
        </header>

        <section className="lux-showcase">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2>Describe. Connect. Approve.</h2>
              <p>It lives in the Build area of Vantage, under CAD.</p>
            </header>
            <ul className="lux-feature-grid">
              {steps.map((step) => (
                <li key={step.title}>
                  <strong>{step.title}</strong>
                  <span>{step.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="technical-note lux-content">
          <h2>Your team still engineers the robot.</h2>
          <p>Check fit, loads, materials, game rules and safety yourselves. The AI helps draw; it does not sign off.</p>
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
            guestLabel="Join the waitlist"
            companion={{ href: "/workflow", label: "How it works", variant: "secondary" }}
          />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
