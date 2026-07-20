import type { Metadata } from "next";
import {
  PRICING_CATALOG,
  catalogDefaultsFootnote,
  raisedPricingSummaryLine,
} from "@vantage/billing/catalog";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingCatalog } from "./pricing-catalog";

export const metadata: Metadata = {
  title: "Pricing — Vantage",
  description:
    "Individual and team Vantage plans with included managed API allowances at provider list rates, Usage Credits, Access + PAYG, Soft-UI hubs, and hard cut-offs—no Vantage markup on model spend.",
  alternates: { canonical: "/pricing" },
};

export default function PricingPage() {
  const catalogNote = catalogDefaultsFootnote();
  const accessPrice = PRICING_CATALOG.access.monthlyUsd;
  const individualPro = PRICING_CATALOG.individual_pro;
  const individualMax = PRICING_CATALOG.individual_max;
  const teamPro = PRICING_CATALOG.team_pro;
  const teamMax = PRICING_CATALOG.team_max;

  return (
    <div className="marketing-site marketing-v2 marketing-dense marketing-pro">
      <SiteHeader />
      <main className="pricing-page">
        <section className="pricing-hero brand-route-hero">
          <p className="brand-hero-wordmark route-wordmark">Vantage</p>
          <span className="section-id">PRICING / INDIVIDUAL OR TEAM</span>
          <h1>Fund private work or the whole team—deliberately.</h1>
          <p>
            Free keeps the Soft-UI competition core useful with BYOK/local AI. Raised paid plans add Vantage managed
            routing across scouting trust, strategy, Event Day/Pit ops, and CAD—with included API allowance at published
            provider rates—then a hard stop unless you buy Usage Credits or enable PAYG. No per-seat student pricing and
            no surprise charges.
          </p>
          <div className="route-hero-actions">
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
            <span className="section-id">USAGE &amp; ECONOMICS</span>
            <h2>No markup on model spend.</h2>
          </div>
          <div>
            <p>
              <strong>Usage Credit = $1 of provider API cost at list rates</strong> (Anthropic, OpenAI, and other
              published tables). Launch debit multiplier is <strong>1.0×</strong>—Vantage does not mark up model spend.
              Included allowances reset with the paid period; purchased or gifted Usage Credits are separate and
              non-withdrawable.
            </p>
            <p>
              After included allowance is exhausted: <strong>hard stop</strong> unless you opt into Usage Credits or PAYG
              (explicit enable + spend cap). Prepaid stopping at zero is the default. BYOK/local cost does not consume
              managed allowance, but plan entitlements and org limits still apply. Managed is stronger via integrated
              routing, tools, and context—not because BYOK is sabotaged.
            </p>
            <p>
              Sponsored free AI, when available, is clearly labeled, low priority, capped per user/org/IP, and never falls
              through to a paid model. Exhaustion offers BYOK, local relay, or upgrade.
            </p>
            <p>
              Checkout stays inactive until Stripe credentials and admin-configured Price IDs exist. Until then, join the
              early-access waitlist—plan numbers live in the admin-configurable catalog and can change for future periods
              with notice; active paid periods keep their snapshotted terms.
            </p>
            <p className="pricing-note">{catalogNote}</p>
            <p className="pricing-footnote">
              <strong>Free vs FRC Assistant:</strong> Free includes Soft-UI offline scouting, cached reference data,
              manual strategy, and pick lists—the competition core that feeds the Assistant. Managed Assistant replies
              (paid allowance, Usage Credits, PAYG, or BYOK/local) still need real event context; they do not invent DEMO
              dashboards or fabricated win rates.
            </p>
          </div>
        </section>

        <section className="waitlist v2-final-waitlist pricing-waitlist soft-waitlist-band" id="waitlist">
          <div>
            <p className="brand-hero-wordmark route-wordmark waitlist-wordmark">Vantage</p>
            <span className="section-id">EARLY ACCESS</span>
            <h2>Join the waitlist before checkout opens.</h2>
            <p>
              Catalog: Access ${accessPrice} · Individual Pro ${individualPro.monthlyUsd} / Max $
              {individualMax.monthlyUsd} · Team Pro ${teamPro.monthlyUsd} / Max ${teamMax.monthlyUsd}. Stripe checkout
              activates when credentials and Price IDs are configured—until then, the waitlist is the path in. Terms
              acceptance is required.
            </p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
