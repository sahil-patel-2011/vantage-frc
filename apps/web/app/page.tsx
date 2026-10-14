import type { Metadata } from "next";
import { WaitlistSection } from "../components/marketing/waitlist-section";
import { MarketingHeroActions, SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroStage } from "../components/marketing/illustrations";
import { DepthSections, SeasonOverview, TrustSection } from "../components/marketing/home-sections";
import { ScrollReveal } from "../components/marketing/scroll-reveal";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";

export const revalidate = 86_400;

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — your FRC team, connected",
  description:
    `Plan, scout, build and learn in one place: pit-first scouting that works offline, team tasks, hours and money, GitHub pull request reviews and guided lessons for FRC teams. Free to use. Existing teams can sign in. Public registration is being prepared.`,
  path: "/",
});

/**
 * The home page, one idea per section: what Vantage is (hero) → the season in four parts →
 * each part in depth → trust and data → questions → the waitlist. Cost is in the trust section
 * and the FAQ, and the Cost page has the detail.
 */
export default function Home() {
  const entityLd = organizationSoftwareJsonLd();
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(entityLd) }} />

        <section className="mx-hero" aria-labelledby="mx-hero-title">
          <div className="mx-wrap">
            <div className="mx-hero-copy">
              <p className="mx-eyebrow">For FIRST Robotics Competition teams</p>
              <h1 className="mx-display" id="mx-hero-title">
                <span>One team.</span> <span>A clearer season.</span>
              </h1>
              <p className="mx-lead">
                Plan the week, scout every match, build the robot and teach new members, in one place your whole
                team shares. Free for FRC teams.
              </p>
              <MarketingHeroActions />
            </div>
            <HeroStage />
          </div>
        </section>

        <SeasonOverview />
        <DepthSections />
        <TrustSection />
        <FAQ />
        <WaitlistSection />
      </main>
      <SiteFooter />
      <ScrollReveal />
    </div>
  );
}
