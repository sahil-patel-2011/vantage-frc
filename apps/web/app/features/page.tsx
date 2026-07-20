import type { Metadata } from "next";
import { hostedApiSavingsCopy, raisedPricingStrip } from "@vantage/billing/catalog";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductGlances } from "../../components/marketing/product-glances";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Product map — Vantage",
  description:
    "Soft-UI hubs FRC teams open after sign-in: Competition, Team, Business, Build, and AI—plus Alliance Selection Desk, Season Planning, CAD agent, and AI API keys.",
  path: "/features",
});

type Status = "Available" | "Shipping" | "Setup required";

const pillars: {
  title: string;
  copy: string;
  status: Status;
  href?: string;
}[] = [
  {
    title: "Competition",
    copy: "Command, My Day, Scouting, Strategy, Form builder, Match checklist, Pick clock, Alliance Selection Desk.",
    status: "Available",
    href: "/features/strategy",
  },
  {
    title: "Team",
    copy: "Calendar, todos, practice, attendance, knowledge — Season Planning Workspace in More.",
    status: "Available",
    href: "/for-teams",
  },
  {
    title: "Business",
    copy: "Budget, sponsors, grants, partners, award evidence.",
    status: "Available",
    href: "/for-teams",
  },
  {
    title: "Build",
    copy: "Kickoff, CAD agent, Code Coach, FMEA, prototypes.",
    status: "Available",
    href: "/features/cad",
  },
  {
    title: "AI",
    copy: "Assistant chat, writer, budgets — AI API keys at /team/ai-keys; hosted routing on paid plans.",
    status: "Available",
    href: "/pricing",
  },
  {
    title: "CAD agent",
    copy: "Approval-gated brief → Onshape or Fusion.",
    status: "Setup required",
    href: "/features/cad",
  },
  {
    title: "Code Coach",
    copy: "Flag risky WPILib patterns; human-approved diffs.",
    status: "Available",
    href: "/features/code",
  },
  {
    title: "Strategy & picks",
    copy: "Competition Strategy tab, Alliance Selection Desk, Pick clock, FRC Assistant.",
    status: "Available",
    href: "/features/strategy",
  },
];

const deepLinks = [
  { href: "/features/strategy", label: "Strategy & Assistant", detail: "Competition Strategy, Pick clock, sourced answers." },
  { href: "/features/cad", label: "CAD agent", detail: "Build hub · Onshape / Fusion." },
  { href: "/features/code", label: "Code Coach", detail: "Build hub · risk review with teaching notes." },
  { href: "/workflow", label: "How it works", detail: "Capture → sync → decide → present." },
] as const;

function StatusBadge({ status }: { status: Status }) {
  const tone = status === "Available" ? "available" : status === "Shipping" ? "shipping" : "setup";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <h1>The product map.</h1>
          <p>
            Soft-UI hubs teams open after sign-in: Competition, Team, Business, Build, and AI—plus featured tools like
            Alliance Selection Desk and Season Planning.
          </p>
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
              <h2 id="product-show-title">Hubs with real module names.</h2>
              <p>Competition, Team, Business, Build, and AI—the same structure after sign-in.</p>
            </header>
            <ProductGlances />
          </div>
        </section>

        <section className="lux-deep-links" aria-labelledby="deep-links-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="deep-links-title">Go deeper.</h2>
            </header>
            <ul className="lux-deep-link-grid">
              {deepLinks.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-pillars" id="supporting-ops" aria-labelledby="pillars-title">
          <div className="lux-content">
            <header className="lux-section-head">
              <h2 id="pillars-title">Status by surface.</h2>
            </header>
            <ul className="lux-pillar-list">
              {pillars.map((item) => (
                <li key={item.title}>
                  <div>
                    <h3>{item.href ? <a href={item.href}>{item.title}</a> : item.title}</h3>
                    <p>{item.copy}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Waitlist or plans.</h2>
            <p>
              Free core with your own keys. {hostedApiSavingsCopy()}{" "}
              <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>.
            </p>
            <ul className="pricing-price-strip" aria-label="Monthly plan prices">
              {raisedPricingStrip().map((item) => (
                <li key={item.id}>
                  <span>{item.label}</span>
                  <strong>{item.price}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div className="pricing-preview-actions">
            <a className="button primary" href="/#waitlist">
              Join waitlist
            </a>
            <a className="button secondary" href="/pricing">
              Pricing
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
