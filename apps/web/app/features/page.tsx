import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductGlances } from "../../components/marketing/product-glances";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Product — Vantage",
  description:
    "What FRC teams open after sign-in: Competition, Team, Business, Build, AI, and Media.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>What you open after sign-in.</h1>
          <p>Six workspaces. No sample scores, no invented match lists.</p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </header>

        <section className="lux-showcase" aria-labelledby="product-show-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="product-show-title">The same hubs in the app.</h2>
              <p>Each one stays empty until your team connects TBA and starts scouting.</p>
            </header>
            <ProductGlances />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
