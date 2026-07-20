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

export const MEDIA_CONTENT_KINDS = ["post", "story", "reel", "press", "other"] as const;
export type MediaContentKind = (typeof MEDIA_CONTENT_KINDS)[number];

export const MEDIA_CONTENT_STATUSES = ["draft", "scheduled", "posted", "cancelled"] as const;
export type MediaContentStatus = (typeof MEDIA_CONTENT_STATUSES)[number];

export const MEDIA_CONTENT_PLATFORMS = [
  "instagram",
  "tiktok",
  "facebook",
  "x",
  "youtube",
  "linkedin",
  "press",
  "other",
] as const;
export type MediaContentPlatform = (typeof MEDIA_CONTENT_PLATFORMS)[number];

/** Hub tab ids for Soft-UI Media workspace + assertHubTabAccess. */
export const MEDIA_HUB_TABS = ["calendar", "drafts", "reminders", "kit", "impact"] as const;
export type MediaHubTab = (typeof MEDIA_HUB_TABS)[number];

export type MediaContentItem = {
  id: string;
  seasonYear: number;
  kind: MediaContentKind;
  status: MediaContentStatus;
  platform: MediaContentPlatform;
  title: string;
  caption: string | null;
  dueAt: string | null;
  remindAt: string | null;
  remindedAt: string | null;
  assignedTo: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type MediaPostDraftSuggestion = {
  status: "live";
  caption: string;
  dueAt: string | null;
  generatedAt: string;
  feature: "media_post_draft";
};

export type MediaPostDraftEmpty = {
  status: "setup_required";
  message: string;
};

export type MediaPostDraftResult = MediaPostDraftSuggestion | MediaPostDraftEmpty;
