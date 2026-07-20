import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "FRC Code Builder / Debugger — Vantage",
  description: "Code Coach flags risky WPILib patterns, teaches safer habits, and proposes human-approved diffs.",
  alternates: { canonical: "/features/code" },
};

const capabilities = [
  { id: "01", title: "Review risk", body: "Blocking loops, hard-coded CAN, unsafe actuators." },
  { id: "02", title: "Explain why", body: "Teaching notes tied to match-pressure failure modes." },
  { id: "03", title: "Safer habits", body: "WPILib-aligned alternatives—not opaque rewrites." },
  { id: "04", title: "Approve diffs", body: "Human-gated proposals; sim stays with the team." },
];

export default function CodeFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Flag risk. Teach the fix.</h1>
          <p>Soft-UI Code Coach—human-approved diffs only.</p>
          <div className="actions">
            <a className="button primary" href="/signin">
              Sign in
            </a>
            <a className="button secondary" href="/features">
              Product overview
            </a>
          </div>
        </header>

        <section className="lux-pillars" aria-labelledby="code-capabilities-title">
          <header className="lux-section-head">
            <h2 id="code-capabilities-title">Review → explain → suggest → approve.</h2>
          </header>
          <ul className="lux-pillar-list">
            {capabilities.map((item) => (
              <li key={item.id}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="product-glances-note">Marketing copy. Code stays empty until a repo is connected.</p>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Join the waitlist.</h2>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
