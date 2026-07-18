// Sponsor Wall domain types. Pure data shapes — no I/O, no framework imports.
// A curated, publishable list of sponsor shout-outs (name, tier, logo, message) plus the
// wall's display settings. Distinct from sponsor-suite's CRM/ROI surfaces.

export type SponsorWallTier = "title" | "platinum" | "gold" | "silver" | "bronze" | "inkind" | "partner";

export type SponsorWallTheme = "light" | "dark" | "team";

export type SponsorWallEntry = {
  id: string;
  sponsorName: string;
  tier: SponsorWallTier;
  logoUrl: string | null;
  websiteUrl: string | null;
  message: string | null;
  displayOrder: number;
  published: boolean;
  createdAt: string;
};

export type SponsorWallSettings = {
  headline: string;
  subtitle: string | null;
  theme: SponsorWallTheme;
  published: boolean;
};

export type SponsorWallTierBreakdown = {
  tier: SponsorWallTier;
  count: number;
};

export type SponsorWallSummary = {
  totalEntries: number;
  publishedEntries: number;
  byTier: SponsorWallTierBreakdown[];
};
