import type { Metadata } from "next";
import { WaitlistSection } from "../components/marketing/waitlist-section";
import {
  MarketingHeroActions,
  SiteFooter,
  SiteHeader,
} from "../components/marketing/site-header";
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
                Scouting, strategy, the build, the budget and the calendar — one login for every student and mentor.
                Scouts keep working with no Wi-Fi, and what they record becomes your pick list and your plan for the
                next match.
              </p>
              <MarketingHeroActions />
              {/* Three things a team can check rather than three adjectives.
                  Every one of them is a screen you can open. */}
              <ul className="mk-hero-proof">
                <li>Keeps working when the venue Wi-Fi does not</li>
                <li>Match predictions that say how sure they are</li>
                <li>Free for every team: AI runs on your own key, or not at all</li>
              </ul>
              <p className="lux-hero-note">Free for every FRC team. We bring teams on one at a time.</p>
            </div>
            <HeroProductPanel />
          </div>
        </section>

        <HomeShowcase />
        <PricingStrip headingId="lux-price-title" />
        <FAQ />

        <WaitlistSection />
      </main>
      <SiteFooter />
    </div>
  );
}
