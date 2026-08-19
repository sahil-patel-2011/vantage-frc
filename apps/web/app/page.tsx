import type { Metadata } from "next";
import { WaitlistForm } from "../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../components/marketing/site-header";
import { FAQ } from "../components/marketing/faq";
import { HeroProductVisual } from "../components/marketing/product-glances";
import { marketingPageMetadata, organizationSoftwareJsonLd } from "../lib/marketing/seo";
import "./marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "Vantage — FRC scouting, event day, and team ops",
  description:
    "Scouting, event day, and team operations for FIRST Robotics Competition teams. One workspace. Invite-only.",
  path: "/",
});

const capabilities = [
  {
    title: "Scout offline",
    copy: "Match and pit forms stay on the tablet. They sync when the venue network comes back.",
  },
  {
    title: "Run event day",
    copy: "Next match, pit cues, and strategy in one place — filled from TBA and your scouts, not sample data.",
  },
  {
    title: "Run the rest of the season",
    copy: "Calendar, budget, CAD, and chat sit with the same team. No extra login pile.",
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
            <p className="lux-kicker">For FRC teams</p>
            <h1 id="lux-hero-title">Your FRC team, in one place.</h1>
            <p>Scouting, event day, and season ops — without the spreadsheet pile.</p>
            <div className="actions">
              <a className="button primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="button secondary" href="/signin">
                Sign in
              </a>
            </div>
          </div>
          <HeroProductVisual />
        </section>

        <section className="lux-season" aria-labelledby="lux-cap-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="lux-cap-title">Three jobs. One login.</h2>
              <p>Nothing on this page is a live score. The product stays empty until your team’s data is connected.</p>
            </header>
            <ul className="lux-feature-grid lux-hub-strip">
              {capabilities.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <span>{item.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <FAQ />

        <section className="lux-waitlist" id="waitlist">
          <div>
            <h2>Request access.</h2>
            <p>Invite-only. We email when your team is provisioned.</p>
          </div>
          <WaitlistForm idPrefix="hero" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
