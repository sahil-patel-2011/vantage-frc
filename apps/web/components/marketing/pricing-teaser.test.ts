import { describe, expect, it } from "vitest";
import { PRICING_CATALOG, everyPlanValueLine, raisedPricingStrip } from "@vantage/billing/catalog";
import {
  TEASER_FALLBACK_BLURB,
  pricingTeaserLede,
  pricingTeaserTiers,
  teaserBlurb,
} from "./pricing-teaser";

const catalog = PRICING_CATALOG as unknown as Record<string, { hostedNote?: string } | undefined>;

describe("pricingTeaserTiers", () => {
  it("takes every label and price straight from the billing catalog", () => {
    const strip = raisedPricingStrip();
    const teaser = pricingTeaserTiers();

    expect(teaser).toHaveLength(strip.length);
    expect(teaser.map((tier) => ({ id: tier.id, label: tier.label, price: tier.price }))).toEqual(
      strip.map((tier) => ({ id: tier.id, label: tier.label, price: tier.price })),
    );
  });

  it("describes each tier with the catalog's own hosted note", () => {
    for (const tier of pricingTeaserTiers()) {
      const note = catalog[tier.id]?.hostedNote;
      expect(tier.blurb).toBe(note && note.length > 0 ? note : TEASER_FALLBACK_BLURB);
    }
  });

  it("gives every tier a unique id and non-empty copy", () => {
    const tiers = pricingTeaserTiers();
    expect(tiers.length).toBeGreaterThan(0);
    expect(new Set(tiers.map((tier) => tier.id)).size).toBe(tiers.length);
    for (const tier of tiers) {
      expect(tier.label.length).toBeGreaterThan(0);
      expect(tier.price.length).toBeGreaterThan(0);
      expect(tier.blurb.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the pricing page for a tier id the catalog does not carry", () => {
    expect(teaserBlurb("some-future-tier")).toBe(TEASER_FALLBACK_BLURB);
  });

  it("leads with the catalog's own value line rather than marketing prose", () => {
    expect(pricingTeaserLede()).toBe(everyPlanValueLine());
  });
});
