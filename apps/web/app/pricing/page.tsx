import type { Metadata } from "next";
import {
  catalogDefaultsFootnote,
  hostedApiSavingsCopy,
} from "@vantage/billing/catalog";
import { WaitlistForm } from "../../components/marketing/waitlist-form";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";
import { PricingCatalog } from "./pricing-catalog";
import { marketingPageMetadata } from "../../lib/marketing/seo";

export const metadata: Metadata = marketingPageMetadata({
  title: "Pricing — Vantage",
  description:
    "Start free with your own AI keys or buy AI credits. Individual and Team plans add hosted AI in the product. Credits go further than bringing your own keys. Hard cutoffs; no surprise overage.",
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
          <p className="lux-kicker">Pricing</p>
          <h1>Start free. Buy AI credits when you need them.</h1>
          <p>
            Free is scouting, event day, and season ops with your own keys — or platform Groq/OpenRouter when the host
            has them. Individual and Team add hosted AI. Hard cutoffs. No surprise overage.
          </p>
          <div className="actions">
            <a className="button primary" href="#credits">
              Buy AI credits
            </a>
            <a className="button secondary" href="/#waitlist">
              Join the waitlist
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
              <strong>{creditsLine}</strong> Hosted calls run inside scouting, strategy, Event Day, CAD, and Assistant—not
              a generic API wallet.
            </p>
            <p>
              Free teams add keys at <a href="/team/ai-keys">/team/ai-keys</a>, or buy credits for hosted usage. Paid
              plans include hosted AI; when you need more, buy credits or enable PAYG with an explicit spend cap.
            </p>
            <p className="pricing-note">{catalogNote}</p>
            <p className="pricing-footnote">
              Free includes offline scouting, reference data, manual strategy, and pick lists. Assistant still needs a
              real event connected.
            </p>
          </div>
        </section>

        <section className="lux-waitlist pricing-waitlist" id="waitlist">
          <div>
            <h2>Join the waitlist.</h2>
            <p>Invite-only. We email when your team is provisioned.</p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
