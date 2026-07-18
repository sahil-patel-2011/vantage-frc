// Media Kit domain types. Pure data shapes — no I/O, no framework imports.
// Grounded in the team's own recorded profile/assets/org record — never fabricated.

export type MediaKitAssetKind = "logo" | "photo" | "graphic" | "other";

export type MediaKitAsset = {
  id: string;
  kind: MediaKitAssetKind;
  title: string;
  url: string;
  description: string | null;
  createdAt: string;
};

export type MediaKitProfile = {
  seasonYear: number;
  missionStatement: string | null;
  teamBio: string | null;
  foundedYear: number | null;
  achievements: string[];
  contactEmail: string | null;
  websiteUrl: string | null;
  updatedAt: string;
};

export type MediaKitDocumentSection = {
  heading: string;
  body: string;
};

export type MediaKitDocument = {
  id: string;
  seasonYear: number;
  title: string;
  sections: MediaKitDocumentSection[];
  createdAt: string;
};

export type MediaKitReadinessTier = "not_started" | "partial" | "ready";

export type MediaKitReadiness = {
  /** 0..1 completeness of the media kit (profile fields + at least one logo asset). */
  score: number;
  tier: MediaKitReadinessTier;
  missingFields: string[];
};
