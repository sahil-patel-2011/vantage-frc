import type { Metadata } from "next";
import {
  PRICING_CATALOG,
  catalogDefaultsFootnote,
  hostedApiSavingsCopy,
  raisedPricingSummaryLine,
} from "@vantage/billing/catalog";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingCatalog } from "./pricing-catalog";

export const metadata: Metadata = {
  title: "Pricing — Vantage",
  description:
    "Free Soft-UI competition core. Paid managed AI with hosted usage ~25% less than BYOK. Hard cutoffs—no surprise overage.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  const catalogNote = catalogDefaultsFootnote();
  const accessPrice = PRICING_CATALOG.access.monthlyUsd;
  const individualPro = PRICING_CATALOG.individual_pro;
  const individualMax = PRICING_CATALOG.individual_max;
  const teamPro = PRICING_CATALOG.team_pro;
  const teamMax = PRICING_CATALOG.team_max;
  const hostedSavings = hostedApiSavingsCopy();

  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="pricing-page">
        <section className="lux-route-hero pricing-hero">
          <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
          <h1>Plans for private work or the whole team.</h1>
          <p>
            Free Soft-UI core with BYOK. Paid adds managed routing and included API—then a hard stop. Hosted AI is about
            25% cheaper than own keys.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="button secondary" href="/features">
              See the product
            </a>
          </div>
        </section>

        <PricingCatalog />

        <section className="payg">
          <div>
            <span className="section-id">USAGE</span>
            <h2>Hosted AI costs less than BYOK.</h2>
          </div>
          <div>
            <p>
              <strong>{hostedSavings}</strong> Prepaid credits buy hosted capacity at the same 0.75× debit.
            </p>
            <p>
              After included allowance: hard stop unless Usage Credits or PAYG (explicit cap). BYOK never consumes managed
              allowance.
            </p>
            <p>Checkout opens when Stripe Price IDs are configured—until then, join the waitlist.</p>
            <p className="pricing-note">{catalogNote}</p>
            <p className="pricing-footnote">
              Free includes offline scouting, reference data, manual strategy, and pick lists. Managed Assistant still
              needs real event context—no DEMO win rates.
            </p>
          </div>
        </section>

        <section className="lux-waitlist pricing-waitlist" id="waitlist">
          <div>
            <p className="lux-wordmark lux-wordmark-sm">Vantage</p>
            <h2>Join the waitlist.</h2>
            <p>
              Access ${accessPrice} · Individual ${individualPro.monthlyUsd}/${individualMax.monthlyUsd} · Team $
              {teamPro.monthlyUsd}/${teamMax.monthlyUsd}. {raisedPricingSummaryLine()}. Terms required.
            </p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
