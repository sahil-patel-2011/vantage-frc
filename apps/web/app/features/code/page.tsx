import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Code Coach — Vantage",
  description:
    "Build hub Code Coach flags risky WPILib patterns, teaches safer habits, and proposes human-approved diffs. Never auto-deploys to a robot.",
  path: "/features/code",
});

const capabilities = [
  { id: "01", title: "Review risk", body: "Blocking loops, hard-coded CAN, unsafe actuators." },
  { id: "02", title: "Explain why", body: "Teaching notes tied to match-pressure failure modes." },
  { id: "03", title: "Safer habits", body: "WPILib-aligned alternatives—not opaque rewrites." },
  { id: "04", title: "Approve diffs", body: "Human-gated proposals; sim stays with the team." },
  { id: "05", title: "AI Bugbot", body: "Metered pass quotes your file. Ungrounded claims are dropped." },
] as const;

export default function CodeFeaturePage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">Code Coach</p>
          <h1>Flag risk. Teach the fix.</h1>
          <p>
            Build hub Code Coach—local pattern review plus metered AI Bugbot. Human-approved diffs only. Never
            auto-deploys to a robot.
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

        <section className="lux-pillars" aria-labelledby="code-capabilities-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="code-capabilities-title">Review → explain → suggest → approve.</h2>
            </header>
            <ul className="lux-pillar-list">
              {capabilities.map((item) => (
                <li key={item.id}>
                  <div>
                    <h3>
                      <span className="lux-step-id">{item.id}</span> {item.title}
                    </h3>
                    <p>{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="product-glances-note">Marketing copy. Code stays empty until a repo is connected.</p>
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Related.</h2>
            <p>
              <a href="/features/strategy">Strategy & Assistant</a> · <a href="/features/cad">CAD agent</a> ·{" "}
              <a href="/pricing">Pricing</a>
            </p>
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
