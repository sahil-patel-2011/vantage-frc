import type { Metadata } from "next";
import { HeroProductPanel } from "../../components/marketing/app-frames";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductHubCatalog } from "../../components/marketing/product-glances";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_HUBS, MARKETING_MENU } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "Features — Vantage",
  description:
    "Explore Home, Competition, Team, Build and Business: scouting, team coordination, robot development and business tools for FRC.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero has-visual">
          <p className="lux-kicker">Product</p>
          <h1>What you open after sign-in.</h1>
          <p>
            Home, Competition, Team, Build and Business organize the app on phones and computers.
            Personal shortcuts keep frequently used tools close; the menu opens the full workspace.
          </p>
          <MarketingRouteActions
            companion={{ href: "/workflow", label: "How it works", variant: "secondary" }}
          />
          <nav className="mk-hub-jump" aria-label="Jump to hub">
            {MARKETING_HUBS.map((hub) => (
              <a href={`#${hub.id}`} key={hub.id}>
                {hub.title}
              </a>
            ))}
          </nav>
          {/* The right half of the first screen was empty on a laptop: show the product there. */}
          <div className="lux-route-hero-visual">
            <HeroProductPanel />
          </div>
        </header>

        <section className="lux-showcase" aria-labelledby="product-show-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="product-show-title">The workspaces and the tools inside them.</h2>
              <p>
                Explore the tools in each workspace. AI assistants require a connected provider or a personal local connection.
              </p>
            </header>
            <ProductHubCatalog />
            <div className="mk-menu-block">
              <header className="lux-section-head">
                <h2>Also included.</h2>
                <p>Travel and packing, data exports, and a Windows desktop app.</p>
              </header>
              <ul className="lux-feature-grid">
                {MARKETING_MENU.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <span>{item.copy}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mk-related-links">
              Deep dives: <a href="/features/strategy">Strategy &amp; Ask AI</a>
              {" · "}
              <a href="/features/cad">CAD agent</a>
              {" · "}
              <a href="/features/code">Code Coach</a>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
