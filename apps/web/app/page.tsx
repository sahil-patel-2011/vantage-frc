import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual } from "../components/marketing/product-glances";
import { raisedPricingStrip } from "@vantage/billing/catalog";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — Competition ops for FRC teams",
  description:
    "Soft-UI hubs for FRC scouting, Event Day, alliance selection, season planning, logistics, build, and AI—with BYOK or credits. Invite-only.",
  path: "/",
});

const hubs = [
  {
    name: "Competition",
    blurb: "Scouting, Event Day Command, Strategy, Alliance Selection Desk.",
  },
  {
    name: "Team",
    blurb: "Calendar, practice, attendance, Season Planning Workspace.",
  },
  {
    name: "Logistics",
    blurb: "Packing, duty roster, visit invites.",
  },
  {
    name: "Business",
    blurb: "Budget, sponsors, grants, award evidence.",
  },
  {
    name: "Build",
    blurb: "Kickoff, CAD agent, Code Coach, shop readiness.",
  },
  {
    name: "AI",
    blurb: "Assistant and writer—bring your own keys or buy credits.",
  },
] as const;

const seasonBeat = [
  {
    step: "01",
    title: "Plan the season",
    copy: "Invite the org, link TBA, publish scout forms, set goals.",
  },
  {
    step: "02",
    title: "Run event day",
    copy: "Offline scouting plus Competition Command and My Day at the venue.",
  },
  {
    step: "03",
    title: "Pick with sources",
    copy: "Strategy and Alliance Selection Desk use scout and public facts—or stay empty.",
  },
] as const;

export default function Home() {
  const entityLd = organizationSoftwareJsonLd();
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(entityLd) }} />

        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-copy">
            <h1 id="lux-hero-title">Competition ops for FRC teams.</h1>
            <p>Scouting, Event Day, alliance desk, season planning, and team hubs—in one Soft-UI workspace.</p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="/features">
                See the product
              </a>
            </div>
          </div>
          <HeroProductVisual />
        </section>

        <section className="lux-season" aria-labelledby="lux-season-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="lux-season-title">Season → venue → picks.</h2>
              <p>One org context from kickoff through alliance selection.</p>
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
                How it works →
              </a>
            </p>
          </div>
        </section>

        <section className="lux-thesis" aria-labelledby="lux-hubs-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="lux-hubs-title">Six hubs after sign-in.</h2>
              <p>The same pillars in the Soft-UI drawer: Competition, Team, Logistics, Business, Build, AI.</p>
            </header>
            <ul className="lux-feature-grid lux-hub-strip">
              {hubs.map((item) => (
                <li key={item.name}>
                  <strong>{item.name}</strong>
                  <span>{item.blurb}</span>
                </li>
              ))}
            </ul>
            <p className="lux-inline-cta">
              <a className="text-link" href="/features">
                Full product map →
              </a>
            </p>
          </div>
        </section>

        <section className="lux-pricing" id="pricing-preview" aria-labelledby="lux-pricing-title">
          <div>
            <h2 id="lux-pricing-title">Start free. Buy credits when you need AI.</h2>
            <p>
              Free includes the product with your own keys. Individual and Team add hosted AI. Top up credits anytime.
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
            <a className="button primary" href="/pricing">
              See pricing
            </a>
            <a className="button secondary" href="/pricing#credits">
              AI credits
            </a>
          </div>
        </section>

        <FAQ />

        <section className="lux-waitlist" id="waitlist">
          <div>
            <h2>Join the waitlist.</h2>
            <p>Invite-only access for FRC teams.</p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
