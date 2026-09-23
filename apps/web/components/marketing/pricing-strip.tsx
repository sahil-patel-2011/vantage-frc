/**
 * Pricing teaser shared by the landing page and /for-teams.
 * Server component, no client JS. Every figure and note comes from the billing
 * catalog, so this strip cannot drift from the real ladder.
 */

import { pricingTeaserByokCopy, pricingTeaserTiers } from "./pricing-teaser";

export function PricingStrip({ headingId }: { headingId: string }) {
  const tiers = pricingTeaserTiers();

  return (
    <section className="mk-price" aria-labelledby={headingId}>
      <div className="lux-content">
        {/*
          The software is free, and that is the first thing this section
          should say.

          It used to open with the word "Pricing" over a ladder of monthly
          figures, which reads as "here are the tiers" — and a mentor skimming
          it concluded the product costs money and that the cheap plan is the
          crippled one. Neither is true: nothing is feature-gated, and the only
          thing on this page that costs anything is AI run on our hardware
          instead of yours, which a team can decline entirely.
        */}
        <header className="lux-section-head" data-reveal>
          <p className="lux-eyebrow">What it costs</p>
          <h2 id={headingId}>Every feature is free, for every team.</h2>
          <p>
            Scouting, strategy, the build, the budget and the shop are the same on every plan. Plans only buy AI that
            runs on our servers — bring your own key, run a model on a shop computer, or skip AI and pay nothing. Each
            plan stops at its allowance, so there is never a surprise bill on a booster club&rsquo;s card.
          </p>
        </header>

        <p className="mk-price-kicker" data-reveal>
          Optional: AI we run for you
        </p>
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
            {pricingTeaserByokCopy()} Prices come straight from the billing catalog; the{" "}
            <a href="/pricing">full detail</a> covers allowances, credit packs and the usage ledger.
          </p>
          <a className="button secondary" href="/pricing">
            How the AI allowances work
          </a>
        </div>
      </div>
    </section>
  );
}
