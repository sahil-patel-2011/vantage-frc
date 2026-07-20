import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual, ProductGlances } from "../components/marketing/product-glances";
import {
  hostedApiSavingsCopy,
  raisedPricingStrip,
  raisedPricingSummaryLine,
} from "@vantage/billing/catalog";

const surfaces = [
  { name: "Scouting", blurb: "Offline forms, voice notes, sync." },
  { name: "Event Day", blurb: "Command, My Day, match checklist." },
  { name: "Strategy", blurb: "Alliance desk, Pick clock, playbooks." },
  { name: "Season planning", blurb: "Goals, milestones, owners." },
  { name: "CAD agent", blurb: "Approval-gated briefs → Onshape/Fusion." },
  { name: "Team & Business", blurb: "Logistics, sponsors, grants, ops." },
] as const;

export default function Home() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-copy">
            <p className="lux-wordmark">Vantage</p>
            <h1 id="lux-hero-title">Scouting, Event Day, strategy, CAD.</h1>
            <p>Soft-UI hubs teams actually open—invite-only, empty until your data connects.</p>
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
            <h2 id="lux-showcase-title">What teams open.</h2>
            <p>Marketing preview. No DEMO metrics.</p>
          </header>
          <ProductGlances />
        </section>

        <section className="lux-thesis" aria-labelledby="lux-surfaces-title">
          <h2 id="lux-surfaces-title">Named surfaces, not fluff.</h2>
          <ul className="lux-feature-grid">
            {surfaces.map((item) => (
              <li key={item.name}>
                <strong>{item.name}</strong>
                <span>{item.blurb}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lux-pricing" id="pricing-preview" aria-labelledby="lux-pricing-title">
          <div>
            <h2 id="lux-pricing-title">Free competition core. Paid for managed AI.</h2>
            <p>
              Free keeps your own keys. Paid adds hosted AI—{hostedApiSavingsCopy()} Hard stop after the included
              hosted window unless Credits or PAYG.
            </p>
            <ul className="pricing-price-strip" aria-label="Monthly plan prices">
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
            <h2>Join the waitlist.</h2>
            <p>
              Terms required. Access is invite-only. {raisedPricingSummaryLine()} on <a href="/pricing">pricing</a>.{" "}
              <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>.
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
