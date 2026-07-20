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

const pillars: { title: string; copy: string; status: Status }[] = [
  { title: "Scouting", copy: "Offline forms, voice notes, form builder, sync.", status: "Available" },
  { title: "Event Day", copy: "Command, My Day, match checklist, pit TV.", status: "Available" },
  { title: "Strategy & picks", copy: "Alliance Selection Desk, Pick clock, Assistant.", status: "Available" },
  { title: "Season planning", copy: "Goals, milestones, owners—from real logs.", status: "Available" },
  { title: "CAD agent", copy: "Approval-gated brief → Onshape or Fusion.", status: "Setup required" },
  { title: "Team & Business", copy: "Logistics, sponsors, grants, knowledge.", status: "Available" },
];

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
          <h1>The Soft-UI product map.</h1>
          <p>Named hubs teams open—not a vague operations platform.</p>
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
          <header className="lux-section-head">
            <h2 id="product-show-title">What teams open first.</h2>
            <p>Marketing previews only.</p>
          </header>
          <ProductGlances />
        </section>

        <section className="lux-pillars" id="supporting-ops" aria-labelledby="pillars-title">
          <header className="lux-section-head">
            <h2 id="pillars-title">Status by surface.</h2>
          </header>
          <ul className="lux-pillar-list">
            {pillars.map((item) => (
              <li key={item.title}>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </div>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        </section>

        <section className="lux-pricing">
          <div>
            <h2>Waitlist or plans.</h2>
            <p>
              Free core with BYOK. {hostedApiSavingsCopy()}{" "}
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
