import { describe, expect, it } from "vitest";
import { voteMutationConfirmed } from "./mutation-confirmed";
import type { PicklistCollabEntry } from "./types";

const entry: PicklistCollabEntry = { id: "entry", teamNumber: 254, teamName: null, tier: "first_pick", position: 1, note: null, addedBy: "me", weightedScore: 2, averageRankSuggestion: 3,
  votes: [{ id: "vote", voterId: "me", weight: 2, rankSuggestion: 3, comment: "Good auto fit", updatedAt: "2026-10-07" }] };
const request = { action: "cast-vote" as const, userId: "me", entryId: "entry", weight: 2, rankSuggestion: 3, comment: "Good auto fit" };

describe("shared pick-list vote acknowledgement", () => {
  it("confirms the intended member, entry and all submitted values", () => {
    expect(voteMutationConfirmed(request, [entry])).toBe(true);
    expect(voteMutationConfirmed({ ...request, comment: "New unsaved feedback" }, [entry])).toBe(false);
    expect(voteMutationConfirmed({ ...request, userId: "another member" }, [entry])).toBe(false);
    expect(voteMutationConfirmed({ ...request, entryId: "another entry" }, [entry])).toBe(false);
    expect(voteMutationConfirmed({ ...request, userId: null }, [entry])).toBe(false);
    expect(voteMutationConfirmed({ ...request, weight: 1 }, [entry])).toBe(false);
    expect(voteMutationConfirmed({ ...request, rankSuggestion: null }, [entry])).toBe(false);
  });
  it("confirms withdrawal only after this member's vote is absent", () => {
    const withdrawal = { action: "remove-vote" as const, userId: "me", entryId: "entry" };
    expect(voteMutationConfirmed(withdrawal, [entry])).toBe(false);
    expect(voteMutationConfirmed(withdrawal, [{ ...entry, votes: [{ ...entry.votes[0], voterId: "other" }] }])).toBe(true);
  });
});
