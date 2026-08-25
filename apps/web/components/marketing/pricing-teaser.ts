/**
 * Marketing pricing teaser data.
 *
 * Nothing here is written by hand: the ladder, the prices, the per-plan note and
 * the value line all come from the billing catalog (`@vantage/billing/catalog`),
 * so the landing page cannot drift from what a team is actually charged. If the
 * catalog ever drops a tier's note, the tier falls back to pointing at /pricing
 * rather than inventing a description.
 */

import {
  PRICING_CATALOG,
  byokEveryPlanCopy,
  everyPlanValueLine,
  raisedPricingStrip,
} from "@vantage/billing/catalog";

export type PricingTeaserTier = {
  id: string;
  label: string;
  price: string;
  blurb: string;
};

export const TEASER_FALLBACK_BLURB = "See the pricing page for what this plan includes.";

/** Catalog notes, read by plan id without assuming which codes exist this season. */
const catalogNotes = PRICING_CATALOG as unknown as Record<string, { hostedNote?: string } | undefined>;

/** What a tier's hosted allowance buys, straight from the catalog. */
export function teaserBlurb(id: string): string {
  const note = catalogNotes[id]?.hostedNote;
  return note && note.length > 0 ? note : TEASER_FALLBACK_BLURB;
}

/** The catalog ladder, joined to each tier's catalog-authored note. */
export function pricingTeaserTiers(): PricingTeaserTier[] {
  return raisedPricingStrip().map((tier) => ({
    id: tier.id,
    label: tier.label,
    price: tier.price,
    blurb: teaserBlurb(tier.id),
  }));
}

/** One-sentence value statement the whole pricing surface leads with. */
export function pricingTeaserLede(): string {
  return everyPlanValueLine();
}

/** The bring-your-own-keys story, true on every plan including Free. */
export function pricingTeaserByokCopy(): string {
  return byokEveryPlanCopy();
}
