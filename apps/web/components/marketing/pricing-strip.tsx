/**
 * Pricing teaser shared by the landing page and /for-teams.
 * Server component, no client JS. Every figure and note comes from the billing
 * catalog, so this strip cannot drift from the real ladder.
 */

import { pricingTeaserByokCopy, pricingTeaserLede, pricingTeaserTiers } from "./pricing-teaser";

export function PricingStrip({ headingId }: { headingId: string }) {
  const tiers = pricingTeaserTiers();

  return (
    <section className="mk-price" aria-labelledby={headingId}>
      <div className="lux-content">
        <header className="lux-section-head" data-reveal>
          <p className="lux-eyebrow">Pricing</p>
          <h2 id={headingId}>Cost should never decide which teams get it.</h2>
          <p>
            {pricingTeaserLede()} Hosted usage stops when the allowance is used — there is no silent overage on a booster
            club&rsquo;s card.
          </p>
        </header>

        <ul className="mk-price-grid" data-reveal>
          {tiers.map((tier) => (
            <li key={tier.id}>
              <span className="mk-price-label">{tier.label}</span>
              <strong className="mk-price-figure">
                {tier.price}
                <small>/mo</small>
              </strong>
              <span className="mk-price-blurb">{tier.blurb}</span>
            </li>
          ))}
        </ul>

        <div className="mk-price-foot" data-reveal>
          <p>
            {pricingTeaserByokCopy()} Prices here are read live from the billing catalog; the{" "}
            <a href="/pricing">pricing page</a> carries the full ladder, credit packs and the usage ledger.
          </p>
          <a className="button secondary" href="/pricing">
            See all plans
          </a>
        </div>
      </div>
    </section>
  );
}
