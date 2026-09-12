import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
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
            Six hubs. Each one is the same software mentors and students use on a build night.
            Related tools sit as tabs inside the hub.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/workflow">
              How it works
            </a>
          </div>
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
              <h2 id="product-show-title">Hubs and the tools inside them.</h2>
              <p>
                Competition, Team, Business, Build, AI, and Media. Nothing below is a live ranking — it is the real
                feature set.
              </p>
            </header>
            <ProductHubCatalog />
            <div className="mk-menu-block">
              <header className="lux-section-head">
                <h2>Also from the menu.</h2>
                <p>Logistics is a drawer pillar. Exports and Desktop are real routes too.</p>
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
              <a href="/features/code">Code</a>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
