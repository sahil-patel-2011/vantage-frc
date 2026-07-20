import type { Metadata } from "next";
import { hostedApiSavingsCopy, raisedPricingStrip } from "@vantage/billing/catalog";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductGlances } from "../../components/marketing/product-glances";

export const metadata: Metadata = {
  title: "Product — Vantage",
  description:
    "Soft-UI surfaces FRC teams open: Scouting, Event Day, Strategy / Pick desk, Season planning, CAD agent, Team & Business.",
  alternates: { canonical: "/features" },
};

type Status = "Available" | "Shipping" | "Setup required";

const pillars: {
  title: string;
  copy: string;
  status: Status;
  href?: string;
}[] = [
  { title: "Scouting", copy: "Offline forms, voice notes, form builder, sync.", status: "Available" },
  { title: "Event Day", copy: "Command, My Day, match checklist, pit TV.", status: "Available" },
  {
    title: "Strategy & picks",
    copy: "Alliance Selection Desk, Pick clock, FRC Assistant.",
    status: "Available",
    href: "/features/strategy",
  },
  { title: "Season planning", copy: "Goals, milestones, owners—from real logs.", status: "Available" },
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
  { title: "Team & Business", copy: "Logistics, sponsors, grants, knowledge.", status: "Available", href: "/for-teams" },
  { title: "AI keys & hosted AI", copy: "BYOK on Free; paid plans add managed routing.", status: "Available", href: "/pricing" },
];

const deepLinks = [
  { href: "/features/strategy", label: "Strategy & Assistant", detail: "Pick desk, playbooks, sourced answers." },
  { href: "/features/cad", label: "CAD agent", detail: "Brief → connector → review." },
  { href: "/features/code", label: "Code Coach", detail: "Risk review with teaching notes." },
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
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>The product map.</h1>
          <p>Named hubs teams open—scouting through business—not a vague ops platform.</p>
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
              <h2 id="product-show-title">What teams open first.</h2>
              <p>Marketing previews only.</p>
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
