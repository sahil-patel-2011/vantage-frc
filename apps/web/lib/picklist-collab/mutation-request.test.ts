import { describe, expect, it } from "vitest";
import { collabMutationRequest } from "./mutation-request";
const orgId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
describe("discussion request bounds", () => {
  it("accepts explicit vote updates and removal", () => {
    expect(collabMutationRequest.safeParse({ action: "cast-vote", orgId, entryId, weight: .1, comment: "Observed no climb attempt" }).success).toBe(true);
    expect(collabMutationRequest.safeParse({ action: "remove-vote", orgId, entryId }).success).toBe(true);
  });
  it.each([0, 5.1, NaN])("rejects invalid weights instead of replacing them with a default: %s", weight => {
    expect(collabMutationRequest.safeParse({ action: "cast-vote", orgId, entryId, weight }).success).toBe(false);
  });
  it("rejects repeated entries or tiers before a reorder", () => {
    expect(collabMutationRequest.safeParse({ action: "set-order", orgId, order: [{ tier: "first_pick", entryIds: [entryId, entryId] }] }).success).toBe(false);
    expect(collabMutationRequest.safeParse({ action: "set-order", orgId, order: [{ tier: "first_pick", entryIds: [entryId] }, { tier: "first_pick", entryIds: [] }] }).success).toBe(false);
  });
  it("bounds names and notes and refuses client-selected actors", () => {
    expect(collabMutationRequest.safeParse({ action: "create-list", orgId, name: "x".repeat(201) }).success).toBe(false);
    expect(collabMutationRequest.safeParse({ action: "set-entry-notes", orgId, entryId, note: "x".repeat(2001) }).success).toBe(false);
    expect(collabMutationRequest.safeParse({ action: "cast-vote", orgId, entryId, userId: "somebody-else" }).success).toBe(false);
  });
});
