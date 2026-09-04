"use client";

import type { CompetitionRelatedId } from "../lib/strategy/competition-related";

/** Retired: Competition tools live in hub tabs and search. */
export function CompetitionHubRelated(_props: {
  orgId?: string | null;
  active?: CompetitionRelatedId;
  include?: CompetitionRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  return null;
}
