import type { PicklistCollabEntry } from "./types";

/** A refreshed list alone is not proof that the caller's vote changed. */
export function voteMutationConfirmed(input: {
  action: "cast-vote" | "remove-vote";
  entryId: string;
  userId: string | null;
  weight?: number;
  rankSuggestion?: number | null;
  comment?: string | null;
}, entries: PicklistCollabEntry[]): boolean {
  if (!input.userId) return false;
  const entry = entries.find(row => row.id === input.entryId);
  const vote = entry?.votes.find(row => row.voterId === input.userId);
  if (input.action === "remove-vote") return !vote;
  return Boolean(vote && vote.weight === input.weight && vote.rankSuggestion === (input.rankSuggestion ?? null) &&
    (vote.comment ?? null) === (input.comment?.trim() || null));
}
