import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual, ProductGlances } from "../components/marketing/product-glances";
import { raisedPricingStrip, raisedPricingSummaryLine } from "@vantage/billing/catalog";

export default function Home() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-copy">
            <p className="lux-wordmark">Vantage</p>
            <h1 id="lux-hero-title">Competition operations for FRC teams.</h1>
            <p>
              One shared season for scouting, Event Day, strategy, CAD, logistics, and metered AI—invite-only, with
              honest empty states.
            </p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="/pricing">
                View pricing
              </a>
            </div>
          </div>
          <HeroProductVisual />
        </section>

        <section className="lux-showcase" aria-labelledby="lux-showcase-title">
          <header className="lux-section-head">
            <h2 id="lux-showcase-title">Built for how teams actually compete.</h2>
            <p>Three quiet looks at the work that matters. Marketing preview only.</p>
          </header>
          <ProductGlances />
        </section>

        <section className="lux-thesis" aria-labelledby="lux-thesis-title">
          <h2 id="lux-thesis-title">One shared season—not five tabs and a group chat.</h2>
          <p>
            Scouting, day-of ops, build, travel, fundraising, knowledge, and metered AI live under the same organization
            and active event. Empty context stays empty. Approvals stay human.
          </p>
        </section>

        <section className="lux-pricing" id="pricing-preview" aria-labelledby="lux-pricing-title">
          <div>
            <h2 id="lux-pricing-title">Free competition core. Raised plans for managed AI.</h2>
            <p>
              Free covers scouting, reference data, manual strategy, exports, and team ops with BYOK or local AI. Paid
              plans add managed routing and included API allowance—then a hard stop unless you buy Usage Credits or enable
              PAYG.
            </p>
            <ul className="pricing-price-strip" aria-label="Raised monthly plan prices">
              {raisedPricingStrip().map((item) => (
                <li key={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.price}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Review plans
            </a>
          </div>
        </section>

        <FAQ />

        <section className="lux-waitlist" id="waitlist">
          <div>
            <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
            <h2>Put one operational picture in front of the whole team.</h2>
            <p>
              Join the prelaunch list—terms acceptance is required. Account verification and administrator-created team
              access remain separate launch steps. Raised plans: {raisedPricingSummaryLine()} on{" "}
              <a href="/pricing">pricing</a>. Read <a href="/terms">terms</a> and <a href="/privacy">privacy</a>.
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
