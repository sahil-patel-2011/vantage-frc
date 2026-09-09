import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HomeShowcase } from "../components/marketing/home-showcase";
import { HeroProductPanel } from "../components/marketing/hero-product";
import { ScrollReveal } from "../components/marketing/scroll-reveal";
import { PricingStrip } from "../components/marketing/pricing-strip";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";
import "./marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — FRC scouting, event day, CAD, and team ops",
  description:
    "Invite-only operations software for FIRST Robotics Competition teams: offline scouting, event day, alliance selection, CAD, Code Coach, business, and metered AI — sourced facts only, never DEMO metrics.",
  path: "/",
});

export default function Home() {
  const entityLd = organizationSoftwareJsonLd();
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <ScrollReveal />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(entityLd) }} />

        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-backdrop" aria-hidden="true" />
          <div className="lux-hero-inner">
            <div className="lux-hero-copy">
              <p className="lux-kicker">For FRC teams · Invite-only</p>
              <h1 id="lux-hero-title">The workspace your team actually runs.</h1>
              <p>
                Offline scouting, event day, alliance selection, CAD, robot code, and season ops in one login. Screens
                stay empty until TBA, scouting, or a connector has real data.
              </p>
              <div className="actions">
                <a className="button primary" href="#waitlist">
                  Request access
                </a>
                <a className="button secondary" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <ul className="mk-hero-proof">
                <li>Invite-only</li>
                <li>Empty until real data</li>
                <li>CAD and code stay human-gated</li>
              </ul>
              <p className="lux-hero-note">
                Nothing on this page is live team data. Every surface stays empty until your team connects its own.
              </p>
            </div>
            <HeroProductPanel />
          </div>
        </section>

        <HomeShowcase />
        <PricingStrip headingId="lux-price-title" />
        <FAQ />

        <section className="lux-waitlist" id="waitlist">
          <div>
            <p className="lux-eyebrow">Closed beta</p>
            <h2>Request access.</h2>
            <p>Invite-only. We email when your team is provisioned. Joining the waitlist does not create an account.</p>
            <p className="lux-hero-note">
              Questions, or want to talk about your team before you join?{" "}
              <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
