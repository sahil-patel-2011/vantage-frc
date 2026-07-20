/** Pure Media workspace domain types — never DEMO metrics. */

export type MediaAssetPreview = {
  id: string;
  kind: string;
  title: string;
  url: string;
  createdAt: string;
};

export type MediaOutreachPreview = {
  id: string;
  title: string;
  category: string;
  scheduledOn: string;
  status: string;
};

export type MediaImpactPreview = {
  id: string;
  title: string;
  category: string;
  occurredOn: string;
  peopleReached: number;
};

export type MediaKitSummary = {
  readinessScore: number;
  readinessTier: "not_started" | "partial" | "ready";
  missingFields: string[];
  assetCount: number;
  logoCount: number;
  photoCount: number;
  documentCount: number;
  recentAssets: MediaAssetPreview[];
};

export type MediaOutreachSummary = {
  upcomingCount: number;
  mediaCategoryCount: number;
  upcoming: MediaOutreachPreview[];
};

export type MediaImpactSummary = {
  mediaActivityCount: number;
  peopleReached: number;
  recent: MediaImpactPreview[];
};

export type MediaSponsorWallSummary = {
  publishedEntryCount: number;
  wallPublished: boolean;
};
