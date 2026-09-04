"use client";

import type { BuildRelatedId } from "../lib/build/build-related";

/** Retired: Build tools live in hub tabs and search. */
export function BuildHubRelated(_props: {
  orgId?: string | null;
  active?: BuildRelatedId;
  include?: BuildRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  return null;
}
