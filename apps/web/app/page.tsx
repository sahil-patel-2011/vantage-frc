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
import { LaunchAvailability } from "../components/marketing/launch-availability";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";
import "./marketing-showcase.css";

export const revalidate = 86_400;

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — your FRC team, connected",
  description:
    "An FRC team workspace for scouting, strategy, team coordination, robot development and business. Free to use, with optional personal AI connections. Team signup planned for December 1, 2026; contact us for early access.",
  path: "/",
});

export default function Home() {
  const entityLd = organizationSoftwareJsonLd();
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(entityLd) }} />

        <section className="lux-hero" aria-labelledby="lux-hero-title">
          <div className="lux-hero-backdrop" aria-hidden="true" />
          <div className="lux-hero-inner">
            <div className="lux-hero-copy">
              <p className="lux-kicker">Built for FIRST Robotics Competition</p>
              <h1 id="lux-hero-title">Your whole team.<br /><span>One connected season.</span></h1>
              <p>
                From the first shop meeting to alliance selection. Bring scouting, team work, robot development
                and business together in a workspace built around how FRC teams work.
              </p>
              <MarketingHeroActions />
              <ul className="mk-hero-proof">
                <li>Scouting collection that saves on your device</li>
                <li>Team, Build and Business alongside Competition</li>
                <li>Free to use. AI connections are optional.</li>
              </ul>
              <LaunchAvailability />
            </div>
            <HeroProductPanel />
          </div>
        </section>

        <HomeShowcase />
        {/* No separate cost section here: free Vantage and optional personal AI are in the hero and the
            FAQ, and the Cost page has the detail. It was said four times on this page. */}
        <FAQ />

        <WaitlistSection />
      </main>
      <SiteFooter />
    </div>
  );
}
