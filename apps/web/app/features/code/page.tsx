import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { marketingPageMetadata } from "../../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Code Coach — Vantage",
  description:
    "Code Coach reads your robot code, points out the mistakes that break robots at events, and explains the fix. Nothing changes without your approval, and it never deploys to a robot.",
  path: "/features/code",
});

const capabilities = [
  { id: "01", title: "Spot the risky parts", body: "Code that can freeze the robot, device IDs typed in by hand, motors that can run with no limit." },
  { id: "02", title: "Explain why", body: "Each note says what goes wrong in a match, in words a new programmer can follow." },
  { id: "03", title: "Show a safer way", body: "A small, standard WPILib fix you can read, not a mystery rewrite." },
  { id: "04", title: "You decide", body: "Suggested changes wait for a person to approve them. Testing stays with your team." },
  { id: "05", title: "Line by line", body: "Every note points to the exact line in your file. If it can't point to a line, it says nothing." },
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
            Code Coach reviews your robot code for common mistakes, with an AI reviewer when you want a second look.
            Nothing changes without your approval, and it never deploys to a robot.
          </p>
          <MarketingRouteActions
            companion={{ href: "/features", label: "Product overview", variant: "secondary" }}
          />
        </header>

        <section className="lux-pillars" aria-labelledby="code-capabilities-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="code-capabilities-title">Find it, explain it, fix it together.</h2>
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
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Related.</h2>
            <p>
              <a href="/features/strategy">Strategy & Assistant</a> · <a href="/features/cad">CAD agent</a> ·{" "}
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
