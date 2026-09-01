import { describe, expect, it } from "vitest";
import {
  buildFirstWeekPlanItems,
  eligibleBuddyCandidates,
  findUnpairedMembers,
  suggestBuddy,
  summarizeOnboardingBuddy,
} from ".";
import type { OnboardingBuddyMember } from "./types";

const ADA = "22222222-2222-4222-8222-222222222222";
const GRACE = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-31T16:00:00.000Z";

function member(
  userId: string,
  overrides: Partial<OnboardingBuddyMember> = {},
): OnboardingBuddyMember {
  return {
    userId,
    name: userId === ADA ? "Ada" : "Grace",
    role: "member",
    joinedAt: NOW,
    tenureDays: 3,
    ...overrides,
  };
}

describe("eligibleBuddyCandidates", () => {
  it("returns other roster members only — never a DEMO identity", () => {
    const members = [member(ADA, { tenureDays: 2 }), member(GRACE, { tenureDays: 400 })];
    const candidates = eligibleBuddyCandidates(members, ADA);
    expect(candidates.map((m) => m.userId)).toEqual([GRACE]);
    expect(candidates.every((m) => !/demo/i.test(m.userId))).toBe(true);
  });
});

describe("suggestBuddy", () => {
  it("picks a real roster user id, not an invented DEMO buddy", () => {
    const members = [
      member(ADA, { tenureDays: 2 }),
      member(GRACE, { tenureDays: 400 }),
    ];
    const suggested = suggestBuddy(members, ADA, {});
    expect(suggested?.userId).toBe(GRACE);
    expect(suggested?.userId).not.toMatch(/demo/i);
  });
});

describe("findUnpairedMembers", () => {
  it("keeps recent joiners who are not already paired", () => {
    const members = [
      member(ADA, { joinedAt: "2026-08-28T16:00:00.000Z", tenureDays: 3 }),
      member(GRACE, { joinedAt: "2025-01-01T00:00:00.000Z", tenureDays: 600 }),
    ];
    const unpaired = findUnpairedMembers(members, new Set(), NOW);
    expect(unpaired.map((m) => m.userId)).toEqual([ADA]);
  });
});

describe("summarizeOnboardingBuddy", () => {
  it("counts only the pairings and members it was given", () => {
    const summary = summarizeOnboardingBuddy(
      [member(ADA), member(GRACE)],
      1,
      [
        {
          id: "p1",
          newMemberId: ADA,
          newMemberName: "Ada",
          buddyId: GRACE,
          buddyName: "Grace",
          status: "active",
          notes: null,
          pairedAt: NOW,
          completedAt: null,
          planItems: [],
          planProgress: { total: 0, done: 0 },
        },
      ],
    );
    expect(summary.totalMembers).toBe(2);
    expect(summary.activePairingCount).toBe(1);
    expect(summary.unpairedCount).toBe(1);
    expect(summary.pairingCoverage).toBe(0.5);
  });
});

describe("buildFirstWeekPlanItems", () => {
  it("is a fixed template, not a DEMO network of fake pairings", () => {
    const items = buildFirstWeekPlanItems();
    expect(items.length).toBeGreaterThan(0);
    expect(JSON.stringify(items)).not.toMatch(/\bDEMO\b/i);
  });
});
