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
  title: "Vantage — the FRC season in one login",
  description:
    "Invite-only FRC software: scouting, Kickoff, Learn CAD, Ask AI, and the shop — Google or an email code. Mentors invite exact emails. Everyone else joins the waitlist.",
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
              <p className="lux-kicker">Invite-only FRC operations</p>
              <h1 id="lux-hero-title">The season, in one login.</h1>
              <p>
                Scouting, Kickoff, Learn CAD, Ask AI, and the shop. Claude Code answers without an API key. Kickoff
                shows 2027 BIOCORE when the manual is not out, and 2026 REBUILT when you can study it. Mentors invite
                exact emails.
              </p>
              <div className="actions">
                <a className="button primary" href="#waitlist">
                  Join the waitlist
                </a>
                <a className="text-link" href="/signin">
                  Already invited? Sign in
                </a>
              </div>
              <ul className="mk-hero-proof">
                <li>Works in the pit, offline</li>
                <li>CAD Video Tutor + real Onshape progress</li>
                <li>No public signup</li>
              </ul>
              <p className="lux-hero-note">
                We bring teams on one at a time. Questions?{" "}
                <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>
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
            <p className="lux-eyebrow">Closed membership</p>
            <h2>Join the waitlist.</h2>
            <p>
              Invite-only. We email when your team is set up. Joining the waitlist does not create an account.
            </p>
            <p className="lux-hero-note">
              Already invited? <a href="/signin">Sign in</a>
              {" · "}
              Questions? <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>
            </p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
