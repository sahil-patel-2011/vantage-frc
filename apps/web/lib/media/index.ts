// Pure, unit-testable Media workspace helpers. No I/O, no framework imports.

export * from "./types";
export {
  buildMediaPostDraft,
  isMediaReminderOverdue,
  mediaCalendarItems,
  mediaDraftItems,
  mediaReminderItems,
} from "./media-content-helpers";

import type {
  MediaContentItem,
  MediaImpactSummary,
  MediaKitSummary,
  MediaOutreachSummary,
  MediaSponsorWallSummary,
} from "./types";

/** True when the Media workspace has nothing recorded yet — Soft-UI empty. */
export function isMediaWorkspaceEmpty(input: {
  kit: Pick<MediaKitSummary, "assetCount" | "documentCount" | "readinessScore">;
  outreach: Pick<MediaOutreachSummary, "upcomingCount" | "mediaCategoryCount">;
  impact: Pick<MediaImpactSummary, "mediaActivityCount">;
  sponsorWall: Pick<MediaSponsorWallSummary, "publishedEntryCount">;
  items?: Pick<MediaContentItem, "id">[];
}): boolean {
  const itemCount = input.items?.length ?? 0;
  return (
    itemCount === 0 &&
    input.kit.assetCount === 0 &&
    input.kit.documentCount === 0 &&
    input.kit.readinessScore <= 0 &&
    input.outreach.upcomingCount === 0 &&
    input.outreach.mediaCategoryCount === 0 &&
    input.impact.mediaActivityCount === 0 &&
    input.sponsorWall.publishedEntryCount === 0
  );
}

/** Hide zeroed summary tiles when the workspace is empty — avoids DEMO counters. */
export function shouldShowMediaSummaryTiles(input: {
  kit: Pick<MediaKitSummary, "assetCount" | "documentCount" | "readinessScore">;
  outreach: Pick<MediaOutreachSummary, "upcomingCount" | "mediaCategoryCount">;
  impact: Pick<MediaImpactSummary, "mediaActivityCount">;
  sponsorWall: Pick<MediaSponsorWallSummary, "publishedEntryCount">;
  items?: Pick<MediaContentItem, "id">[];
}): boolean {
  return !isMediaWorkspaceEmpty(input);
}

/** Real counts only — never invent DEMO totals. */
export function formatMediaMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function mediaReadinessPct(score: number): string {
  if (!Number.isFinite(score) || score <= 0) return "—";
  return `${Math.round(score * 100)}%`;
}
