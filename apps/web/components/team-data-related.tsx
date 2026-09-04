"use client";

import type { TeamDataRelatedId } from "../lib/team-data/team-data-related";

/** Retired: Team-data tools live in hub tabs and search. */
export function TeamDataRelated(_props: {
  orgId?: string | null;
  active?: TeamDataRelatedId;
  include?: TeamDataRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  return null;
}
