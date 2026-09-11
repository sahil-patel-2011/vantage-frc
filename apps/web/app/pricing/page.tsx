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
    "Every feature on every plan, including Free. Pro, Pro+, and Max add hosted AI; you can use your own AI on any plan. Usage stops when the allowance is used. Access is invite-only.",
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
          <h1>Every feature on every plan. You are choosing how much AI you want.</h1>
          <p>
            Nothing is feature-gated: Free has the same scouting, event day, build and business tools as Max. Plans
            differ only in hosted AI allowance, and you can use your own AI on any plan — including Free. Usage
            stops when the allowance is used. No surprise bills.
          </p>
          <p className="pricing-access-note">
            Vantage is invite-only. Join the waitlist and we will email you when your team is set up, or write to{" "}
            <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a> if you want to talk it through
            first.
          </p>
          <div className="actions">
            <a className="button primary" href="/#waitlist">
              Join the waitlist
            </a>
            <a className="text-link" href="#credits">
              How AI credits work
            </a>
          </div>
        </section>

        <PricingCatalog />

        <section className="payg" id="credits">
          <div>
            <h2>How usage works</h2>
          </div>
          <div>
            <p>
              <strong>{creditsLine}</strong> Hosted calls run inside scouting, strategy, Event Day, CAD, and Assistant —
              not a generic wallet.
            </p>
            <p>
              Free teams can use their own AI, or buy credits for hosted usage. Paid plans include hosted AI; when you
              need more, buy credits or turn on pay-as-you-go with an explicit spend cap.
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
              Invite-only. We email when your team is set up. Already invited? <a href="/signin">Sign in</a>
              {" · "}
              Questions? <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>
            </p>
          </div>
          <WaitlistForm idPrefix="pricing" />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
