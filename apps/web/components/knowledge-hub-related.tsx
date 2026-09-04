"use client";

import type { KnowledgeRelatedId } from "../lib/knowledge/knowledge-related";

/** Retired: Knowledge tools live in hub tabs and search. */
export function KnowledgeHubRelated(_props: {
  orgId?: string | null;
  active?: KnowledgeRelatedId;
  include?: KnowledgeRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  return null;
}
