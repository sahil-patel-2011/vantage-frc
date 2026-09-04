"use client";

import type { TeamHubRelatedId } from "../lib/team/team-related";

export type { TeamHubRelatedId };

/** Retired: Team tools live in hub tabs and search. */
export function TeamHubRelated(_props: {
  orgId?: string | null;
  active?: TeamHubRelatedId;
  include?: TeamHubRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  return null;
}
