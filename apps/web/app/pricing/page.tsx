import type { Metadata } from "next";
import {
  catalogDefaultsFootnote,
  everyPlanValueLine,
  hostedApiSavingsCopy,
} from "@vantage/billing/catalog";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingCatalog } from "./pricing-catalog";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Pricing — Vantage",
  description:
    "Every feature on every plan, including Free. Free $0 · Pro $20 · Pro+ $60 · Max $100. Bring any AI key or run local models on any plan; paid plans add hosted AI allowance. Hard cutoffs; no surprise overage.",
  path: "/pricing",
});

export default function PricingPage() {
  const catalogNote = catalogDefaultsFootnote();
  const creditsLine = hostedApiSavingsCopy();

  return (
    <div className="marketing-site marketing-lux">
      <SiteHeader />
      <main className="pricing-page">
        <section className="lux-route-hero pricing-hero">
          <h1>Every feature. Every plan. Even Free.</h1>
          <p>
            {everyPlanValueLine()} Cost should never decide which teams get the teaching layer: Free runs the entire
            product on your own AI keys or local models, plus a small hosted allowance on budget models. Pro, Pro+,
            and Max only buy more hosted AI. Spend stops at a hard cutoff, so there is no surprise overage on a
            booster club&rsquo;s card.
          </p>
          <div className="actions">
            <a className="button primary" href="#credits">
              Buy AI credits
            </a>
            <a className="button secondary" href="/#waitlist">
              Request access
            </a>
          </div>
        </section>

        <PricingCatalog />

        <section className="payg">
          <div>
            <h2>How usage works</h2>
          </div>
          <div>
            <p>
              <strong>{creditsLine}</strong> Hosted calls run inside scouting, strategy, Event Day, CAD and the
              Assistant — not a generic API wallet.
            </p>
            <p>
              Add keys at <a href="/team/ai-keys">/team/ai-keys</a> on any plan — BYOK and local endpoints are
              unlimited by Vantage, you pay your provider directly. Hosted allowances are metered against an
              append-only ledger you can read; when one runs out you buy credits or enable pay-as-you-go with an
              explicit spend cap. Nothing overages silently.
            </p>
            <p className="pricing-note">{catalogNote}</p>
          </div>
        </section>

        <section className="lux-waitlist pricing-waitlist" id="waitlist">
          <div>
            <h2>Request access.</h2>
            <p>Invite-only while Vantage is in closed beta. We email when your team is provisioned.</p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
