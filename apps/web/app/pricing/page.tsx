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
    "Every feature on every plan, including Free. Pro, Pro+, and Max add hosted AI; bring your own keys on any plan. Hard cutoffs, no surprise overage. Access is invite-only while Vantage is in closed beta.",
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
          {/* "Start free" promised self-serve signup that does not exist —
              access is invite-only, so the headline contradicted the product.
              Say what a team will pay once it is provisioned instead. */}
          <h1>Every feature on every plan. You are choosing how much AI you want.</h1>
          <p>
            Nothing is feature-gated: Free has the same scouting, event day, build and business tools as Max. Plans
            differ only in hosted AI allowance, and you can bring your own provider key on any plan — including Free.
            Hard cutoffs. No surprise overage.
          </p>
          <p className="pricing-access-note">
            Vantage is invite-only while it is in closed beta. Join the waitlist and we will email you when your team is
            provisioned, or write to{" "}
            <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a> if you want to talk it through
            first.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Request access
            </a>
            <a className="button secondary" href="#credits">
              How AI credits work
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
            <p>
              Invite-only. We email when your team is provisioned. Questions first?{" "}
              <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>
            </p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
