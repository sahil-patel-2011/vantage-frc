import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { MarketingHeroActions, SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HomeShowcase } from "../components/marketing/home-showcase";
import { HeroProductPanel } from "../components/marketing/hero-product";
import { ScrollReveal } from "../components/marketing/scroll-reveal";
import { PricingStrip } from "../components/marketing/pricing-strip";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";
import "./marketing-showcase.css";

export const revalidate = 86_400;

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — the FRC season in one login",
  description:
    "Free software for FIRST Robotics Competition teams: scouting that tells you which robot to pick, match predictions that say how sure they are, the build, the budget and the shop — in one login, and it keeps working when the venue Wi-Fi does not.",
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
              <p className="lux-kicker">Free software for FRC teams</p>
              <h1 id="lux-hero-title">Your season stops living in spreadsheets.</h1>
              <p>
                Scouting, the schedule, the build, the budget and the shop — one place that already knows how an FRC
                season works. Your scouts fill in tablets and you get back which robot to pick, not a percentage of
                rows completed.
              </p>
              <MarketingHeroActions />
              {/* Three things a team can check rather than three adjectives.
                  Every one of them is a screen you can open. */}
              <ul className="mk-hero-proof">
                <li>Keeps working when the venue Wi-Fi does not</li>
                <li>Match predictions that say how sure they are</li>
                <li>Free, and your team&rsquo;s data stays your team&rsquo;s</li>
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
