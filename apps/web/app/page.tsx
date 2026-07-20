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
  { name: "Scouting", blurb: "Offline forms, voice notes, sync.", href: "/features" },
  { name: "Event Day", blurb: "Command, My Day, match checklist.", href: "/features" },
  { name: "Strategy", blurb: "Alliance desk, Pick clock, playbooks.", href: "/features/strategy" },
  { name: "Season planning", blurb: "Goals, milestones, owners.", href: "/features" },
  { name: "CAD agent", blurb: "Approval-gated briefs → Onshape/Fusion.", href: "/features/cad" },
  { name: "Team & Business", blurb: "Logistics, sponsors, grants, ops.", href: "/for-teams" },
] as const;

const seasonBeat = [
  {
    step: "01",
    title: "Build the season",
    copy: "Plan goals, connect TBA, publish scout forms.",
  },
  {
    step: "02",
    title: "Capture at the venue",
    copy: "Offline scouting and Event Day boards stay useful when Wi-Fi drops.",
  },
  {
    step: "03",
    title: "Decide with sources",
    copy: "Strategy, Pick desk, and Assistant cite scout and public facts—or stay empty.",
  },
] as const;

export default function Home() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-copy">
            <p className="lux-wordmark">Vantage</p>
            <h1 id="lux-hero-title">One place for the competition season.</h1>
            <p>
              Scouting, Event Day, alliance desk, season planning, CAD, and team ops—quiet Soft-UI hubs that stay
              empty until your data connects.
            </p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="/features">
                See the product
              </a>
            </div>
            <p className="lux-hero-meta">
              <a href="/workflow">How it works</a>
              <span aria-hidden="true">·</span>
              <a href="/pricing">Pricing</a>
              <span aria-hidden="true">·</span>
              <a href="/signin">Sign in</a>
            </p>
          </div>
          <HeroProductVisual />
        </section>

        <section className="lux-showcase" aria-labelledby="lux-showcase-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="lux-showcase-title">What teams open.</h2>
              <p>Calm product frames—not DEMO metrics.</p>
            </header>
            <ProductGlances />
          </div>
        </section>

        <section className="lux-season" aria-labelledby="lux-season-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="lux-season-title">Season → venue → picks.</h2>
              <p>One org event context from kickoff through alliance selection.</p>
            </header>
            <ol className="lux-season-steps">
              {seasonBeat.map((item) => (
                <li key={item.step}>
                  <b>{item.step}</b>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ol>
            <p className="lux-inline-cta">
              <a className="text-link" href="/workflow">
                Full workflow →
              </a>
            </p>
          </div>
        </section>

        <section className="lux-thesis" aria-labelledby="lux-surfaces-title">
          <div className="lux-content">
            <h2 id="lux-surfaces-title">Named surfaces, not fluff.</h2>
            <ul className="lux-feature-grid">
              {surfaces.map((item) => (
                <li key={item.name}>
                  <a href={item.href}>
                    <strong>{item.name}</strong>
                    <span>{item.blurb}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-pricing" id="pricing-preview" aria-labelledby="lux-pricing-title">
          <div>
            <h2 id="lux-pricing-title">Free competition core. Paid for hosted AI.</h2>
            <p>
              Free keeps your own keys. Paid adds Vantage-hosted AI as a service—{hostedApiSavingsCopy()} Hard stop
              after the included window unless Credits or PAYG.
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
