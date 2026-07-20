import type { Metadata } from "next";
import { raisedPricingStrip } from "@vantage/billing/catalog";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { ProductGlances } from "../../components/marketing/product-glances";

export const metadata: Metadata = {
  title: "Product — Vantage",
  description:
    "Vantage product overview: scouting, Event Day, Soft-UI hubs, strategy, Business, CAD setup, and hard usage cutoffs—with honest Available, Shipping, and Setup-required labels.",
  alternates: { canonical: "/features" },
};

type Status = "Available" | "Shipping" | "Setup required";

const pillars: {
  title: string;
  copy: string;
  status: Status;
}[] = [
  {
    title: "Scouting",
    copy: "Offline match and pit forms, custom schemas, voice notes, QR handoffs, and trust signals—synced facts, not folklore.",
    status: "Available",
  },
  {
    title: "Event Day",
    copy: "Shared next-match readiness plus personal shifts and todos so each person knows what they own.",
    status: "Available",
  },
  {
    title: "Strategy & Assistant",
    copy: "Win/loss, playbooks, and Soft-UI picks from real event and scout facts. Empty until data exists.",
    status: "Available",
  },
  {
    title: "Business & logistics",
    copy: "Sponsors, grants, orders, travel, and packing beside the competition calendar.",
    status: "Available",
  },
  {
    title: "Kickoff → CAD",
    copy: "Season intent becomes an approval-gated brief. Onshape or Fusion when connectors are configured.",
    status: "Setup required",
  },
  {
    title: "Metered AI",
    copy: "Hard cutoffs at included allowance. Resume with Usage Credits, PAYG, or a higher plan—no silent overage.",
    status: "Available",
  },
];

function StatusBadge({ status }: { status: Status }) {
  const tone =
    status === "Available" ? "available" : status === "Shipping" ? "shipping" : "setup";
  return <span className={`status-badge ${tone}`}>{status}</span>;
}

export default function FeaturesPage() {
  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="route-page">
        <header className="lux-route-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>The product, without the noise.</h1>
          <p>
            Competition ops in one Soft-UI shell—scouting through Event Day, strategy, Business, and CAD—with honest
            status labels and empty states until real data exists.
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
          <header className="lux-section-head">
            <h2 id="product-show-title">What teams open first.</h2>
            <p>Marketing previews only—not live dashboards.</p>
          </header>
          <ProductGlances />
        </section>

        <section className="lux-pillars" id="supporting-ops" aria-labelledby="pillars-title">
          <header className="lux-section-head">
            <h2 id="pillars-title">Around the season.</h2>
            <p>Six surfaces. Clear status. No feature laundry list.</p>
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
            <h2>Join the waitlist or review raised plans.</h2>
            <p>
              Free competition core with BYOK. Managed API at list rates, then hard stop unless Credits or PAYG.{" "}
              <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>.
            </p>
            <ul className="pricing-price-strip" aria-label="Raised monthly plan prices">
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
