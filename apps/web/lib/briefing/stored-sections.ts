// Which stored (org-authored) briefing sections to render.
//
// The pre-match briefing fuses TBA schedule with work the team already did in Match cards,
// Counter-book, Defense, and Watchlist. TBA lineup / EPA must never invent those sections or a
// win percentage. These helpers decide inclusion from stored rows only: present → include;
// otherwise the UI shows the honest empty + setup step.

import { winProbabilityFor, type BriefingPrediction } from "../briefing";
import type { BriefingCard, BriefingCounterBook, BriefingDefensePlan, BriefingWatchNote } from "./types";

export const STORED_BRIEFING_SECTIONS = ["card", "counterBooks", "watchNotes", "defensePlans"] as const;
export type StoredBriefingSection = (typeof STORED_BRIEFING_SECTIONS)[number];

export type StoredBriefingInput = {
  card: BriefingCard | null;
  counterBooks: readonly BriefingCounterBook[];
  watchNotes: readonly BriefingWatchNote[];
  defensePlans: readonly BriefingDefensePlan[];
};

export type StoredBriefingInclusion = {
  included: StoredBriefingSection[];
  empty: StoredBriefingSection[];
};

function present(id: StoredBriefingSection, input: StoredBriefingInput): boolean {
  switch (id) {
    case "card":
      return input.card != null;
    case "counterBooks":
      return input.counterBooks.length > 0;
    case "watchNotes":
      return input.watchNotes.length > 0;
    case "defensePlans":
      return input.defensePlans.length > 0;
  }
}

/**
 * Section inclusion from stored rows only — TBA schedule/EPA never marks a section ready.
 *
 * When every stored source is empty, `included` is [] and `empty` is all four ids so the
 * briefing can render honest setup steps instead of a fabricated game plan.
 */
export function includeStoredBriefingSections(input: StoredBriefingInput): StoredBriefingInclusion {
  const included: StoredBriefingSection[] = [];
  const empty: StoredBriefingSection[] = [];
  for (const id of STORED_BRIEFING_SECTIONS) {
    (present(id, input) ? included : empty).push(id);
  }
  return { included, empty };
}

/** True when the org has stored opponent intel (not TBA EPA / rank). */
export function hasStoredOpponentIntel(
  input: Pick<StoredBriefingInput, "counterBooks" | "watchNotes" | "defensePlans">,
): boolean {
  return input.counterBooks.length > 0 || input.watchNotes.length > 0 || input.defensePlans.length > 0;
}

/**
 * Stored win probability for our alliance, or null.
 *
 * Never invents a DEMO / placeholder win % from TBA-only schedule. A modelVersion that names
 * itself demo is refused even if numbers are present.
 */
export function briefingWinProbability(
  prediction: BriefingPrediction | null,
  alliance: "red" | "blue" | null,
): number | null {
  if (!prediction || !alliance) return null;
  if (/\bdemo\b/i.test(prediction.modelVersion)) return null;
  const value = winProbabilityFor(prediction, alliance);
  return value != null && Number.isFinite(value) ? value : null;
}
