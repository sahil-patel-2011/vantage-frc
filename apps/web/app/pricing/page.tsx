import type { Metadata } from "next";
import {
  PRICING_CATALOG,
  catalogDefaultsFootnote,
  hostedApiEconomicsSoftLine,
  hostedApiSavingsCopy,
  raisedPricingSummaryLine,
} from "@vantage/billing/catalog";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingCatalog } from "./pricing-catalog";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Pricing — Vantage",
  description:
    "Free competition core with your own AI keys. Paid plans add Vantage-hosted AI as a service—cheaper than BYOK—with scouting, strategy, and Event Day built in. Hard cutoffs; no surprise overage.",
  path: "/pricing",
});

export default function PricingPage() {
  const catalogNote = catalogDefaultsFootnote();
  const accessPrice = PRICING_CATALOG.access.monthlyUsd;
  const individualPro = PRICING_CATALOG.individual_pro;
  const individualMax = PRICING_CATALOG.individual_max;
  const teamPro = PRICING_CATALOG.team_pro;
  const teamMax = PRICING_CATALOG.team_max;
  const hostedSavings = hostedApiSavingsCopy();
  const economicsSoft = hostedApiEconomicsSoftLine();

  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="pricing-page">
        <section className="lux-route-hero pricing-hero">
          <h1>Free core. Hosted AI when you want it.</h1>
          <p>
            Free keeps Competition, Team, Business, and Build with your own keys or local models. Paid plans add
            Vantage-hosted AI as a service—cheaper than BYOK—with scouting, strategy, and Event Day built in. Hard
            cutoffs; no surprise overage.
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
            <span className="section-id">HOSTED AI</span>
            <h2>A service—not an API wallet.</h2>
          </div>
          <div>
            <p>
              <strong>{hostedSavings}</strong> Scouting, strategy, Event Day, CAD assistant, and more live inside the
              product. You are not renting a generic model meter.
            </p>
            <p>
              {economicsSoft} Bring-your-own-key stays on Free and never consumes managed hosted usage. After the
              included hosted window: hard stop unless you add Usage Credits or enable PAYG with an explicit spend
              cap.
            </p>
            <p>
              Free teams add keys at <a href="/team/ai-keys">/team/ai-keys</a> after sign-in. Checkout opens when
              Stripe Price IDs are configured—until then, join the waitlist.
            </p>
            <p className="pricing-note">{catalogNote}</p>
            <p className="pricing-footnote">
              Free includes offline scouting, reference data, manual strategy, and pick lists. Managed Assistant still
              needs real event context—no DEMO win rates.
            </p>
          </div>
        </section>

        <section className="lux-waitlist pricing-waitlist" id="waitlist">
          <div>
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
