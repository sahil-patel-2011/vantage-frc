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
  title: "Vantage — one place for everything your FRC team does",
  description:
    "Invite-only workspace for FIRST Robotics Competition teams: learn CAD and code, run the shop, scout offline, pick the alliance, keep the money straight — one login for every student and mentor, with AI that helps and shows its work.",
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
              <h1 id="lux-hero-title">One place for everything your team does.</h1>
              <p>
                Learn CAD and code, run the shop, scout the event, pick the alliance, keep the money straight — one
                login for every student and mentor, from a new member&rsquo;s first day to the last match. AI helps
                with strategy, predictions and design, and shows its work.
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
                <li>Teaches new members</li>
                <li>Works in the pit, offline</li>
                <li>Your data stays yours</li>
              </ul>
              <p className="lux-hero-note">
                Invite-only while we bring teams on one at a time. Write to{" "}
                <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a> to ask for one.
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
