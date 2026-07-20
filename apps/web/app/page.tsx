import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual, ProductGlances } from "../components/marketing/product-glances";
import {
  hostedApiSavingsCopy,
  raisedPricingStrip,
  raisedPricingSummaryLine,
} from "@vantage/billing/catalog";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — Competition ops for FRC teams",
  description:
    "Soft-UI hubs for FRC scouting, Event Day Command, strategy, Alliance Selection Desk, season planning, CAD, and team ops. Invite-only. Empty until real data connects.",
  path: "/",
});

const hubs = [
  {
    name: "Competition",
    blurb: "Command, My Day, Scouting, Strategy, Form builder, Pick clock, Alliance Selection Desk.",
    href: "/features",
  },
  {
    name: "Team",
    blurb: "Calendar, practice, attendance, knowledge — Season Planning Workspace in More.",
    href: "/for-teams",
  },
  {
    name: "Business",
    blurb: "Budget, sponsors, grants, partners, and award evidence.",
    href: "/for-teams",
  },
  {
    name: "Build",
    blurb: "Kickoff, CAD agent, Code Coach, FMEA, shop readiness.",
    href: "/features/cad",
  },
  {
    name: "AI",
    blurb: "Assistant chat, writer, budgets — BYOK at /team/ai-keys or hosted on paid plans.",
    href: "/pricing",
  },
] as const;

const seasonBeat = [
  {
    step: "01",
    title: "Set the season",
    copy: "Invite the org, link TBA, publish scout forms, plan goals.",
  },
  {
    step: "02",
    title: "Capture at the venue",
    copy: "Offline scouting and Competition Command / My Day when Wi-Fi drops.",
  },
  {
    step: "03",
    title: "Decide with sources",
    copy: "Strategy, Alliance Selection Desk, and Assistant cite scout and public facts—or stay empty.",
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
            <p>
              Scouting, Strategy, Event Day Command, alliance selection, season planning, CAD, and team ops—in Soft-UI
              hubs that stay empty until your data connects.
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
              <h2 id="lux-showcase-title">Five hubs. Real module names.</h2>
              <p>Competition, Team, Business, Build, and AI—the same structure you open after sign-in.</p>
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
            <h2 id="lux-surfaces-title">Where work lives.</h2>
            <ul className="lux-feature-grid">
              {hubs.map((item) => (
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
              Free keeps your own keys at /team/ai-keys. Paid adds Vantage-hosted AI as a service—{hostedApiSavingsCopy()}{" "}
              Hard stop after the included window unless Credits or PAYG.
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
