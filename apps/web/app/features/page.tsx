import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductHubCatalog } from "../../components/marketing/product-glances";
import { marketingPageMetadata } from "../../lib/marketing/seo";
import { MARKETING_HUBS, MARKETING_MENU, MARKETING_WORKSPACES } from "../../lib/marketing/product-story";
import { MIcon } from "../../components/marketing/marketing-icons";
import "../marketing-showcase.css";

export const metadata: Metadata = marketingPageMetadata({
  title: "Product — Vantage",
  description:
    "What FRC teams open after sign-in: four workspaces — Scout, Compete, Build, and Run season — over real tools that stay empty until your data is connected.",
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
            Four workspaces in the menu, and the hubs they open underneath. Each one is the same software mentors and
            students use — not a brochure with sample scores.
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

        <section className="lux-problem" aria-labelledby="product-spaces-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <p className="lux-eyebrow">The menu</p>
              <h2 id="product-spaces-title">Four workspaces, not a tool list.</h2>
              <p>
                This is the whole top level of the app. Everything below lives inside one of these four, and search
                reaches any of it directly.
              </p>
            </header>
            <ul className="lux-feature-grid lux-feature-grid-4">
              {MARKETING_WORKSPACES.map((workspace) => (
                <li key={workspace.id}>
                  <span className="lux-card-icon">
                    <MIcon name={workspace.icon} />
                  </span>
                  <strong>{workspace.title}</strong>
                  <span>{workspace.copy}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-showcase" aria-labelledby="product-show-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="product-show-title">Hubs and the tools inside them.</h2>
              <p>
                Each card says which workspace opens it. Nothing below is a live ranking — it is the real feature set.
              </p>
            </header>
            <ProductHubCatalog />
            <div className="mk-menu-block">
              <header className="lux-section-head">
                <h2>Also in the box.</h2>
                <p>Not everything needs a menu row. These are real routes you reach from search.</p>
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
