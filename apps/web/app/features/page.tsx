import type { Metadata } from "next";
import { MarketingRouteActions, SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductHubCatalog } from "../../components/marketing/product-glances";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_HUBS, MARKETING_MENU } from "../../lib/marketing/product-story";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "Product — Vantage",
  description:
    "What FRC teams open after sign-in: Team, Build, Competition, and Business — every tool inside one of four workspaces, with Ask AI on every page.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-kicker">Product</p>
          <h1>What you open after sign-in.</h1>
          <p>
            Four workspaces — Team, Build, Competition and Business — the same software mentors and students
            use on a build night. Related tools sit as tabs inside each one, and search finds any of them by name.
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
        </header>

        <section className="lux-showcase" aria-labelledby="product-show-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="product-show-title">The workspaces and the tools inside them.</h2>
              <p>
                Every tool listed here ships today. Ask AI works across all four when a team turns it on.
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
              Deep dives: <a href="/features/strategy">Strategy &amp; Assistant</a>
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
